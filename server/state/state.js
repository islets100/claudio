const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "state.db");

let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT,
      song_name TEXT NOT NULL,
      artist TEXT,
      played_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      context TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      plan_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // 默认偏好
  const defaults = [
    ["volume", "0.8"],
    ["theme", "dark"],
    ["tts_enabled", "true"],
  ];
  const upsert = db.prepare(
    "INSERT INTO prefs(key,value,updated_at) VALUES(?,?,datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  );
  for (const [k, v] of defaults) {
    upsert.run(k, v);
  }

  return db;
}

function close() {
  if (db) db.close();
}

// ---- messages ----

const stmtAddMsg = () =>
  db.prepare(
    "INSERT INTO messages(role,content,metadata) VALUES(?,?,?)"
  );

function addMessage(role, content, meta = {}) {
  stmtAddMsg().run(role, content, JSON.stringify(meta));
}

function getMessages(limit = 50) {
  return db
    .prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?")
    .all(limit)
    .reverse();
}

// ---- plays ----

const stmtAddPlay = () =>
  db.prepare(
    "INSERT INTO plays(song_id,song_name,artist,context) VALUES(?,?,?,?)"
  );

function addPlay(songId, songName, artist, context = {}) {
  stmtAddPlay().run(songId, songName, artist, JSON.stringify(context));
}

function getRecentPlays(limit = 20) {
  return db
    .prepare("SELECT * FROM plays ORDER BY played_at DESC LIMIT ?")
    .all(limit);
}

// ---- plan ----

function setPlan(date, planObj) {
  db.prepare(
    `INSERT INTO plan(date,plan_json,updated_at) VALUES(?,?,datetime('now','localtime'))
     ON CONFLICT(date) DO UPDATE SET plan_json=excluded.plan_json, updated_at=excluded.updated_at`
  ).run(date, JSON.stringify(planObj));
}

function getPlan(date) {
  const row = db.prepare("SELECT * FROM plan WHERE date = ?").get(date);
  if (!row) return null;
  row.plan_json = JSON.parse(row.plan_json);
  return row;
}

// ---- prefs ----

function setPref(key, value) {
  db.prepare(
    `INSERT INTO prefs(key,value,updated_at) VALUES(?,?,datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(key, String(value));
}

function getPref(key) {
  const row = db.prepare("SELECT value FROM prefs WHERE key = ?").get(key);
  return row ? row.value : null;
}

function getAllPrefs() {
  const rows = db.prepare("SELECT key, value FROM prefs").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

module.exports = {
  init,
  close,
  addMessage,
  getMessages,
  addPlay,
  getRecentPlays,
  setPlan,
  getPlan,
  setPref,
  getPref,
  getAllPrefs,
};
