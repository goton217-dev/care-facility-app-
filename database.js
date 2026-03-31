const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      pin TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facilities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      visit_date TEXT DEFAULT '',
      facility_type TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id SERIAL PRIMARY KEY,
      facility_id INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      item_key TEXT NOT NULL,
      rating INTEGER,
      note TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(facility_id, user_id, item_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      facility_id INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
  if (parseInt(rows[0].count) === 0) {
    const users = [
      { name: '長男',           pin: '1111', role: 'family' },
      { name: '次男',           pin: '2222', role: 'family' },
      { name: '長女',           pin: '3333', role: 'family' },
      { name: 'ケアマネージャー', pin: '9999', role: 'caregiver' },
    ];
    for (const u of users) {
      await pool.query(
        'INSERT INTO users (name, pin, role) VALUES ($1, $2, $3)',
        [u.name, bcrypt.hashSync(u.pin, 10), u.role]
      );
    }
    console.log('初期ユーザーを作成しました');
  }
}

function now() {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

module.exports = { pool, initDB, now };
