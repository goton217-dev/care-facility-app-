const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { loadDB, saveDB, initDB, now } = require('./database');

const app = express();
const PORT = 3000;

initDB();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'care-facility-secret-2024',
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
app.post('/api/login', (req, res) => {
  const { name } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.name === name);
  if (!user) return res.status(401).json({ error: '名前が見つかりません' });
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
app.get('/api/users', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.users.map(u => ({ id: u.id, name: u.name, role: u.role })));
});

// 施設一覧
app.get('/api/facilities', requireAuth, (req, res) => {
  const db = loadDB();
  const result = db.facilities
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(f => {
      const creator = db.users.find(u => u.id === f.created_by);
      return { ...f, created_by_name: creator ? creator.name : '' };
    });
  res.json(result);
});

// 施設追加
app.post('/api/facilities', requireFamily, (req, res) => {
  const { name, address, phone, visit_date, facility_type } = req.body;
  if (!name) return res.status(400).json({ error: '施設名は必須です' });
  const db = loadDB();
  const facility = {
    id: db.nextId.facility++,
    name, address: address || '', phone: phone || '',
    visit_date: visit_date || '', facility_type: facility_type || '',
    created_by: req.session.user.id,
    created_at: now()
  };
  db.facilities.push(facility);
  saveDB(db);
  res.json(facility);
});

// 施設更新
app.put('/api/facilities/:id', requireFamily, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, address, phone, visit_date, facility_type } = req.body;
  const db = loadDB();
  const idx = db.facilities.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ error: '見つかりません' });
  db.facilities[idx] = { ...db.facilities[idx], name, address: address || '', phone: phone || '', visit_date: visit_date || '', facility_type: facility_type || '' };
  saveDB(db);
  res.json(db.facilities[idx]);
});

// 施設削除
app.delete('/api/facilities/:id', requireFamily, (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  db.facilities = db.facilities.filter(f => f.id !== id);
  db.evaluations = db.evaluations.filter(e => e.facility_id !== id);
  db.comments = db.comments.filter(c => c.facility_id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// 評価一覧
app.get('/api/facilities/:id/evaluations', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const result = db.evaluations
    .filter(e => e.facility_id === id)
    .map(e => {
      const user = db.users.find(u => u.id === e.user_id);
      return { ...e, user_name: user ? user.name : '' };
    });
  res.json(result);
});

// 評価を保存（upsert）
app.post('/api/facilities/:id/evaluations', requireFamily, (req, res) => {
  const facility_id = parseInt(req.params.id);
  const { item_key, rating, note } = req.body;
  const user_id = req.session.user.id;
  const db = loadDB();
  const idx = db.evaluations.findIndex(e => e.facility_id === facility_id && e.user_id === user_id && e.item_key === item_key);
  if (idx !== -1) {
    db.evaluations[idx] = { ...db.evaluations[idx], rating: rating || null, note: note || '', updated_at: now() };
  } else {
    db.evaluations.push({ id: db.nextId.evaluation++, facility_id, user_id, item_key, rating: rating || null, note: note || '', updated_at: now() });
  }
  saveDB(db);
  res.json({ ok: true });
});

// コメント一覧
app.get('/api/facilities/:id/comments', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const result = db.comments
    .filter(c => c.facility_id === id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(c => {
      const user = db.users.find(u => u.id === c.user_id);
      return { ...c, user_name: user ? user.name : '', user_role: user ? user.role : '' };
    });
  res.json(result);
});

// コメント追加
app.post('/api/facilities/:id/comments', requireAuth, (req, res) => {
  const facility_id = parseInt(req.params.id);
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'コメントを入力してください' });
  const db = loadDB();
  const comment = {
    id: db.nextId.comment++,
    facility_id,
    user_id: req.session.user.id,
    body: body.trim(),
    created_at: now()
  };
  db.comments.push(comment);
  saveDB(db);
  const user = db.users.find(u => u.id === req.session.user.id);
  res.json({ ...comment, user_name: user ? user.name : '', user_role: user ? user.role : '' });
});

// コメント削除
app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const comment = db.comments.find(c => c.id === id);
  if (!comment) return res.status(404).json({ error: '見つかりません' });
  if (comment.user_id !== req.session.user.id) return res.status(403).json({ error: '権限がありません' });
  db.comments = db.comments.filter(c => c.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\nサーバー起動中: http://localhost:${PORT}\n`);
  console.log('初期ログイン情報:');
  console.log('  名前: 長男          PIN: 1111');
  console.log('  名前: 次男          PIN: 2222');
  console.log('  名前: 長女          PIN: 3333');
  console.log('  名前: ケアマネージャー  PIN: 9999');
});
