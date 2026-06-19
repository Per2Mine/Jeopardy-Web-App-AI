const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db = null;

async function getDatabase() {
  if (db) return db;

  const dbDir = process.env.DATABASE_DIR || __dirname;
  const dbPath = path.join(dbDir, 'database.sqlite');
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign key support
  await db.run('PRAGMA foreign_keys = ON');

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      security_question TEXT,
      security_answer_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      categories TEXT NOT NULL,
      is_complete INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
    );
  `);

  // Migrations for existing databases
  try {
    await db.run('ALTER TABLE users ADD COLUMN security_question TEXT');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE users ADD COLUMN security_answer_hash TEXT');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    await db.run('ALTER TABLE quizzes ADD COLUMN is_complete INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore
  }

  return db;
}

module.exports = { getDatabase };
