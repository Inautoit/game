'use strict';
// Almacén de sesiones en SQLite para que la sesión sobreviva a reinicios.
const session = require('express-session');
const { db } = require('./db');

const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 30; // 30 días

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare(
      'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires'
    );
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }

  expiry(sess) {
    const exp = sess?.cookie?.expires;
    return exp ? new Date(exp).getTime() : Date.now() + DEFAULT_TTL;
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.delStmt.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.touchStmt.run(this.expiry(sess), sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
}

module.exports = { SqliteStore };
