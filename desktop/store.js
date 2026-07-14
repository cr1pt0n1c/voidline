'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('./crypto');

/**
 * Same idea as the CLI client's db.js, but backed by a single encrypted
 * JSON blob instead of SQLite. For a desktop GUI this is simpler to
 * package (no native module compilation needed for Windows/Mac/Linux
 * builds) at the cost of rewriting the whole file on every message —
 * fine at prototype scale, worth revisiting if history grows large.
 */

function saltPath(dataDir) {
  return path.join(dataDir, 'store.salt.json');
}
function storePath(dataDir) {
  return path.join(dataDir, 'store.enc.json');
}

function deriveStorageKey(dataDir, passphrase) {
  const p = saltPath(dataDir);
  if (fs.existsSync(p)) {
    const { salt } = JSON.parse(fs.readFileSync(p, 'utf8'));
    return crypto.deriveKey(passphrase, salt).key;
  }
  const { key, salt } = crypto.deriveKey(passphrase);
  fs.writeFileSync(p, JSON.stringify({ salt }), { mode: 0o600 });
  return key;
}

function loadStore(dataDir, key) {
  const file = storePath(dataDir);
  if (!fs.existsSync(file)) {
    return { contacts: {}, messages: [] }; // contacts: { pubkey: label }
  }
  const { ciphertext, nonce } = JSON.parse(fs.readFileSync(file, 'utf8'));
  let json;
  try {
    json = crypto.openFromStorage(ciphertext, nonce, key);
  } catch {
    throw new Error('Wrong passphrase, or the local store file is corrupted/tampered.');
  }
  return JSON.parse(json);
}

function saveStore(dataDir, key, data) {
  const sealed = crypto.sealForStorage(JSON.stringify(data), key);
  fs.writeFileSync(storePath(dataDir), JSON.stringify(sealed), { mode: 0o600 });
}

module.exports = { deriveStorageKey, loadStore, saveStore };
