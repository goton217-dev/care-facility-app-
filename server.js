const express = require('express');
const session = require('express-session');
const path = require('path');
const { pool, initDB, now } = require('./database');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

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

// ── Kasaneru: 介護記録 ────────────────────────────────────

// 記録一覧
app.get('/api/kasaneru/records', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, u.name as user_name,
           COUNT(rr.id)::int as reaction_count
    FROM care_records r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN record_reactions rr ON rr.record_id = r.id
    GROUP BY r.id, u.name
    ORDER BY r.created_at DESC
    LIMIT 50
  `);
  res.json(rows);
});

// 自分がリアクション済みの記録IDリスト
app.get('/api/kasaneru/my-reactions', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT record_id FROM record_reactions WHERE user_id = $1',
    [req.session.user.id]
  );
  res.json(rows.map(r => r.record_id));
});

// 記録を投稿
app.post('/api/kasaneru/records', requireAuth, async (req, res) => {
  const { selections, comment, photos } = req.body;
  if (!selections || typeof selections !== 'object') {
    return res.status(400).json({ error: '記録データが不正です' });
  }
  const { rows } = await pool.query(
    `INSERT INTO care_records (user_id, record_date, selections, comment, photos, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      req.session.user.id,
      new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      JSON.stringify(selections),
      comment || '',
      JSON.stringify(photos || []),
      now()
    ]
  );
  res.json({ id: rows[0].id });
});

// リアクションをトグル
app.post('/api/kasaneru/records/:id/react', requireAuth, async (req, res) => {
  const record_id = parseInt(req.params.id);
  const user_id = req.session.user.id;
  const { rows } = await pool.query(
    'SELECT id FROM record_reactions WHERE record_id=$1 AND user_id=$2',
    [record_id, user_id]
  );
  if (rows.length > 0) {
    await pool.query('DELETE FROM record_reactions WHERE record_id=$1 AND user_id=$2', [record_id, user_id]);
    res.json({ reacted: false });
  } else {
    await pool.query('INSERT INTO record_reactions (record_id, user_id) VALUES ($1,$2)', [record_id, user_id]);
    res.json({ reacted: true });
  }
});

// 秘書アシスタント
app.post('/api/assistant', requireAuth, async (req, res) => {
  const { messages, facilityId } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'メッセージが必要です' });
  }

  try {
    const { rows: facilities } = await pool.query(`
      SELECT f.*, u.name as created_by_name
      FROM facilities f LEFT JOIN users u ON f.created_by = u.id
      ORDER BY f.id DESC
    `);

    const evalLabels = {
      insulin: 'インシュリン対応', monthly_fee: '月額費用',
      initial_fee: '入居金・初期費用', insurance_extra: '介護保険外料金',
      atmosphere: '見学時の雰囲気', staff: '職員の対応',
      vacancy: '空き状況', medical: '医療体制',
      meal: '食事内容', outing: '外出・面会制限',
      care_manager: 'ケアマネ選択', move_out: '退去の要件'
    };

    let system = `あなたは介護施設比較アプリ「見守りノート」のAI秘書アシスタントです。
高齢の家族の介護施設選びをサポートするため、家族が見学・評価した施設情報をもとに、専門的かつ親切なアドバイスを提供します。

【評価項目の説明】
インシュリン対応: 施設でインシュリン注射を行えるか
月額費用: 月々の利用料（介護保険自己負担含む）
入居金・初期費用: 入居時に必要な一時金
介護保険外料金: 保険適用外の追加サービス費用
見学時の雰囲気: 施設の清潔感・明るさ・においなど
職員の対応: 親切さ・丁寧さ・コミュニケーション力
空き状況: 現在の空き・入居待ち状況
医療体制: 看護師配置・協力医療機関・緊急対応
食事内容: 食事の質・刻み食・経管栄養対応
外出・面会制限: 面会時間・外出規制
ケアマネ選択: 施設指定か自由選択か
退去の要件: 医療依存度・認知症進行時の対応

`;

    if (facilities.length > 0) {
      system += `【登録施設 ${facilities.length}件】\n`;
      for (const f of facilities) {
        system += `・${f.name}（${f.facility_type || '種別未設定'}）`;
        if (f.visit_date) system += ` 見学日:${f.visit_date}`;
        if (f.address) system += ` ${f.address}`;
        system += '\n';
      }
      system += '\n';
    } else {
      system += '（施設はまだ登録されていません）\n\n';
    }

    if (facilityId) {
      const fac = facilities.find(f => f.id === parseInt(facilityId));
      if (fac) {
        const { rows: evals } = await pool.query(`
          SELECT e.*, u.name as user_name
          FROM evaluations e LEFT JOIN users u ON e.user_id = u.id
          WHERE e.facility_id = $1
        `, [fac.id]);

        system += `【現在閲覧中の施設: ${fac.name}】\n`;
        if (evals.length > 0) {
          for (const e of evals) {
            const label = evalLabels[e.item_key] || e.item_key;
            const stars = e.rating ? '★'.repeat(e.rating) + '☆'.repeat(5 - e.rating) : '未評価';
            system += `  [${e.user_name}] ${label}: ${stars}`;
            if (e.note) system += ` / ${e.note}`;
            system += '\n';
          }
        } else {
          system += '  （評価データなし）\n';
        }
        system += '\n';
      }
    }

    system += `【現在のユーザー】${req.session.user.name}（${req.session.user.role === 'family' ? '家族' : 'ケアマネージャー'}）\n\n`;
    system += `簡潔かつ親切に日本語で回答してください。専門用語には補足説明を加えてください。`;

    const recentMessages = messages.slice(-20);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: recentMessages
    });

    const textBlock = response.content.find(b => b.type === 'text');
    res.json({ reply: textBlock?.text || '申し訳ありません、応答を生成できませんでした。' });
  } catch (err) {
    console.error('Assistant API error:', err.message);
    res.status(500).json({ error: 'アシスタントエラーが発生しました' });
  }
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
