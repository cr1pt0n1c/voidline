'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('./crypto');

/**
 * Local history, and ONLY local history — nothing here ever leaves
 * the device except as an explicit, user-initiated encrypted export.
 *
 * Every row's `ciphertext` column is plaintext-message sealed with
 * crypto_secretbox under a key derived from the user's passphrase
 * (Argon2id, see crypto.js). SQLite itself does not encrypt the file
 * on disk in this prototype — the encryption happens at the app
 * layer, per-row, before anything is written.
 *
 * Swap-in path for production: replace better-sqlite3 with a
 * SQLCipher-backed driver (e.g. @journeyapps/sqlcipher or
 * better-sqlite3-multiple-ciphers) to get full-file encryption too,
 * so even the schema/table names aren't visible on disk. Keeping
 * app-layer encryption either way is still worth it — defense in
 * depth if the SQLCipher key is ever compromised, and it makes
 * per-message export/deletion trivial.
 */

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'history.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_pubkey TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      pubkey TEXT PRIMARY KEY,
      label TEXT
    );
  `);
  return db;
}

function saveMessage(db, storageKey, { peerPubkey, direction, plaintext, ts }) {
  const sealed = crypto.sealForStorage(plaintext, storageKey);
  db.prepare(
    `INSERT INTO messages (peer_pubkey, direction, ciphertext, nonce, ts) VALUES (?,?,?,?,?)`
  ).run(peerPubkey, direction, sealed.ciphertext, sealed.nonce, ts);
}

function loadHistory(db, storageKey, peerPubkey) {
  const rows = db
    .prepare(`SELECT * FROM messages WHERE peer_pubkey = ? ORDER BY ts ASC`)
    .all(peerPubkey);
  return rows.map((r) => ({
    direction: r.direction,
    ts: r.ts,
    text: crypto.openFromStorage(r.ciphertext, r.nonce, storageKey),
  }));
}

function upsertContact(db, pubkey, label) {
  db.prepare(
    `INSERT INTO contacts (pubkey, label) VALUES (?,?)
     ON CONFLICT(pubkey) DO UPDATE SET label=excluded.label`
  ).run(pubkey, label);
}

function listContacts(db) {
  return db.prepare(`SELECT * FROM contacts`).all();
}

module.exports = { openDb, saveMessage, loadHistory, upsertContact, listContacts };
