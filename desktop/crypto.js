'use strict';

// NOTE: the "sumo" build is required (not plain libsodium-wrappers) because
// the standard build excludes crypto_pwhash (Argon2id) to save bundle size.
const sodium = require('libsodium-wrappers-sumo');
const fs = require('fs');
const path = require('path');

let ready = false;
async function init() {
  if (!ready) {
    await sodium.ready;
    ready = true;
  }
}

/**
 * Identity = an X25519 keypair. That's it. No email, no phone number,
 * no server-assigned username. The base64 public key IS the account.
 *
 * The private key is stored locally, wrapped (secretbox) under a key
 * derived from the user's passphrase via Argon2id (crypto_pwhash).
 * Without the passphrase, the identity file is unusable ciphertext.
 */

function b64(buf) {
  return sodium.to_base64(buf, sodium.base64_variants.URLSAFE_NO_PADDING);
}
function fromB64(str) {
  return sodium.from_base64(str, sodium.base64_variants.URLSAFE_NO_PADDING);
}

// ---- passphrase -> symmetric key (Argon2id) --------------------------

function deriveKey(passphrase, saltB64) {
  const salt = saltB64
    ? fromB64(saltB64)
    : sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  return { key, salt: b64(salt) };
}

// ---- identity keypair, encrypted at rest ------------------------------

function identityPath(dataDir) {
  return path.join(dataDir, 'identity.json');
}

async function loadOrCreateIdentity(dataDir, passphrase) {
  await init();
  fs.mkdirSync(dataDir, { recursive: true });
  const p = identityPath(dataDir);

  if (fs.existsSync(p)) {
    const wrapped = JSON.parse(fs.readFileSync(p, 'utf8'));
    const { key } = deriveKey(passphrase, wrapped.salt);
    const nonce = fromB64(wrapped.nonce);
    const ciphertext = fromB64(wrapped.ciphertext);
    let plain;
    try {
      plain = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    } catch {
      throw new Error('Wrong passphrase, or identity file is corrupted/tampered.');
    }
    const { publicKey, privateKey } = JSON.parse(sodium.to_string(plain));
    return {
      publicKey: fromB64(publicKey),
      privateKey: fromB64(privateKey),
      publicKeyB64: publicKey,
    };
  }

  // First run: generate a fresh identity keypair and seal it.
  const kp = sodium.crypto_box_keypair();
  const { key, salt } = deriveKey(passphrase);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const payload = sodium.from_string(
    JSON.stringify({ publicKey: b64(kp.publicKey), privateKey: b64(kp.privateKey) })
  );
  const ciphertext = sodium.crypto_secretbox_easy(payload, nonce, key);

  fs.writeFileSync(
    p,
    JSON.stringify({
      salt,
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
    }),
    { mode: 0o600 }
  );

  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicKeyB64: b64(kp.publicKey),
  };
}

// ---- end-to-end message encryption (crypto_box: X25519 + XSalsa20-Poly1305) --

function encryptForPeer(plaintext, peerPublicKeyB64, myPrivateKey) {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const peerPub = fromB64(peerPublicKeyB64);
  const blob = sodium.crypto_box_easy(
    sodium.from_string(plaintext),
    nonce,
    peerPub,
    myPrivateKey
  );
  return { blob: b64(blob), nonce: b64(nonce) };
}

function decryptFromPeer(blobB64, nonceB64, peerPublicKeyB64, myPrivateKey) {
  const blob = fromB64(blobB64);
  const nonce = fromB64(nonceB64);
  const peerPub = fromB64(peerPublicKeyB64);
  const plain = sodium.crypto_box_open_easy(blob, nonce, peerPub, myPrivateKey);
  return sodium.to_string(plain);
}

// ---- local-storage encryption (for the message history DB) -----------

function sealForStorage(plaintext, storageKey) {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    sodium.from_string(plaintext),
    nonce,
    storageKey
  );
  return { ciphertext: b64(ciphertext), nonce: b64(nonce) };
}

function openFromStorage(ciphertextB64, nonceB64, storageKey) {
  const ciphertext = fromB64(ciphertextB64);
  const nonce = fromB64(nonceB64);
  const plain = sodium.crypto_secretbox_open_easy(ciphertext, nonce, storageKey);
  return sodium.to_string(plain);
}

module.exports = {
  init,
  b64,
  fromB64,
  deriveKey,
  loadOrCreateIdentity,
  encryptForPeer,
  decryptFromPeer,
  sealForStorage,
  openFromStorage,
};
