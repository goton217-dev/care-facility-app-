const express = require('express');
const session = require('express-session');
const path = require('path');
const { pool, initDB, now } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'care-facility-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '未ログインです' });
  next();
}
function requireFamily(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'family') {
    return res.status(403).json({ error: '権限がありません' });
  }
  next();
}

// ログイン
app.post('/api/login', async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE name = $1', [name]);
  if (rows.length === 0) return res.status(401).json({ error: '名前が見つかりません' });
  const user = rows[0];
  req.session.user = { id: user.id, name: user.name, role: user.role };
  res.json({ user: { id: user.id, name: user.name, role: user.role } });
});

// ログアウト
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// 現在のユーザー
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

// ユーザー一覧
app.get('/api/users', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, role FROM users ORDER BY id');
  res.json(rows);
});

// 施設一覧
app.get('/api/facilities', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT f.*, u.name as created_by_name
    FROM facilities f
    LEFT JOIN users u ON f.created_by = u.id
    ORDER BY f.id DESC
  `);
  res.json(rows);
});

// 施設追加
app.post('/api/facilities', requireFamily, async (req, res) => {
  const { name, address, phone, visit_date, facility_type } = req.body;
  if (!name) return res.status(400).json({ error: '施設名は必須です' });
  const { rows } = await pool.query(
    'INSERT INTO facilities (name, address, phone, visit_date, facility_type, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [name, address || '', phone || '', visit_date || '', facility_type || '', req.session.user.id, now()]
  );
  res.json(rows[0]);
});

// 施設更新
app.put('/api/facilities/:id', requireFamily, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, address, phone, visit_date, facility_type } = req.body;
  const { rows } = await pool.query(
    'UPDATE facilities SET name=$1, address=$2, phone=$3, visit_date=$4, facility_type=$5 WHERE id=$6 RETURNING *',
    [name, address || '', phone || '', visit_date || '', facility_type || '', id]
  );
  if (rows.length === 0) return res.status(404).json({ error: '見つかりません' });
  res.json(rows[0]);
});

// 施設削除
app.delete('/api/facilities/:id', requireFamily, async (req, res) => {
  const id = parseInt(req.params.id);
  await pool.query('DELETE FROM facilities WHERE id = $1', [id]);
  res.json({ ok: true });
});

// 評価一覧
app.get('/api/facilities/:id/evaluations', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query(`
    SELECT e.*, u.name as user_name
    FROM evaluations e
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.facility_id = $1
  `, [id]);
  res.json(rows);
});

// 評価を保存（upsert）
app.post('/api/facilities/:id/evaluations', requireFamily, async (req, res) => {
  const facility_id = parseInt(req.params.id);
  const { item_key, rating, note } = req.body;
  const user_id = req.session.user.id;
  await pool.query(`
    INSERT INTO evaluations (facility_id, user_id, item_key, rating, note, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (facility_id, user_id, item_key)
    DO UPDATE SET rating=$4, note=$5, updated_at=$6
  `, [facility_id, user_id, item_key, rating || null, note || '', now()]);
  res.json({ ok: true });
});

// コメント一覧
app.get('/api/facilities/:id/comments', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query(`
    SELECT c.*, u.name as user_name, u.role as user_role
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.facility_id = $1
    ORDER BY c.created_at ASC
  `, [id]);
  res.json(rows);
});

// コメント追加
app.post('/api/facilities/:id/comments', requireAuth, async (req, res) => {
  const facility_id = parseInt(req.params.id);
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'コメントを入力してください' });
  const { rows } = await pool.query(
    'INSERT INTO comments (facility_id, user_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
    [facility_id, req.session.user.id, body.trim(), now()]
  );
  const comment = rows[0];
  const userResult = await pool.query('SELECT name, role FROM users WHERE id = $1', [req.session.user.id]);
  const user = userResult.rows[0];
  res.json({ ...comment, user_name: user.name, user_role: user.role });
});

// コメント削除
app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query('SELECT * FROM comments WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: '見つかりません' });
  if (rows[0].user_id !== req.session.user.id) return res.status(403).json({ error: '権限がありません' });
  await pool.query('DELETE FROM comments WHERE id = $1', [id]);
  res.json({ ok: true });
});

// バイタル一覧
app.get('/api/vitals', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*, u.name as user_name
    FROM vitals v
    LEFT JOIN users u ON v.user_id = u.id
    ORDER BY v.recorded_date DESC, v.created_at DESC
  `);
  res.json(rows);
});

// バイタル追加
app.post('/api/vitals', requireFamily, async (req, res) => {
  const { recorded_date, temperature, bp_systolic, bp_diastolic, pulse, spo2, weight, note } = req.body;
  if (!recorded_date) return res.status(400).json({ error: '記録日は必須です' });
  const { rows } = await pool.query(
    `INSERT INTO vitals (user_id, recorded_date, temperature, bp_systolic, bp_diastolic, pulse, spo2, weight, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.session.user.id, recorded_date,
     temperature || null, bp_systolic || null, bp_diastolic || null,
     pulse || null, spo2 || null, weight || null,
     note || '', now()]
  );
  res.json(rows[0]);
});

// バイタル削除
app.delete('/api/vitals/:id', requireFamily, async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query('SELECT * FROM vitals WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: '見つかりません' });
  if (rows[0].user_id !== req.session.user.id) return res.status(403).json({ error: '権限がありません' });
  await pool.query('DELETE FROM vitals WHERE id = $1', [id]);
  res.json({ ok: true });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\nサーバー起動中: http://localhost:${PORT}\n`);
    console.log('初期ログイン情報:');
    console.log('  名前: 長男');
    console.log('  名前: 次男');
    console.log('  名前: 長女');
    console.log('  名前: ケアマネージャー');
  });
}).catch(err => {
  console.error('DB初期化エラー:', err);
  process.exit(1);
});
