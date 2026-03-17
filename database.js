const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, 'careapp.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function initDB() {
  let data = loadDB();
  if (data) return data;

  data = {
    users: [],
    facilities: [],
    evaluations: [],
    comments: [],
    nextId: { user: 1, facility: 1, evaluation: 1, comment: 1 }
  };

  // 初期ユーザー
  data.users.push({ id: 1, name: '長男',          pin: bcrypt.hashSync('1111', 10), role: 'family' });
  data.users.push({ id: 2, name: '次男',          pin: bcrypt.hashSync('2222', 10), role: 'family' });
  data.users.push({ id: 3, name: '長女',          pin: bcrypt.hashSync('3333', 10), role: 'family' });
  data.users.push({ id: 4, name: 'ケアマネージャー', pin: bcrypt.hashSync('9999', 10), role: 'caregiver' });
  data.nextId.user = 5;

  saveDB(data);
  console.log('データベースを初期化しました');
  return data;
}

function now() {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

module.exports = { loadDB, saveDB, initDB, now };
