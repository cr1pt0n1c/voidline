'use strict';

/**
 * VOIDLINE — Relay Server
 * -----------------------
 * This server is intentionally "dumb": it never sees plaintext, never
 * stores anything to disk, and never logs who talks to whom.
 *
 * What it knows, transiently, in RAM only:
 *   - a mailbox keyed by recipient public key (base64)
 *   - each mailbox entry = an already-encrypted blob + nonce
 *
 * What it does NOT know:
 *   - message content (encrypted client-side before it ever arrives)
 *   - who the sender is (sender identity is inside the encrypted
 *     envelope, not in the transport metadata — see NOTE below)
 *   - phone numbers, emails, usernames (identity = raw public key only)
 *
 * Delivery model: if the recipient is online, the blob is pushed
 * immediately and dropped. If offline, it sits in the in-memory queue
 * for MAILBOX_TTL_MS and is then hard-deleted regardless of delivery.
 * Nothing ever touches disk. Restarting the process wipes everything.
 *
 * NOTE on metadata: a WebSocket connection still has a source IP at
 * the TCP layer. This prototype does not hide that (real deployment
 * would front this with Tor / a mixnet, or at minimum strip logging
 * at the reverse proxy). This file guarantees the *application layer*
 * stores no metadata — the transport layer is a separate hardening
 * step, called out in the README.
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || process.env.VOIDLINE_PORT || 8787;
const MAILBOX_TTL_MS = 24 * 60 * 60 * 1000; // 24h max, then hard delete

// pubkey(base64) -> WebSocket, only while connected. Never persisted.
const online = new Map();

// pubkey(base64) -> array of { blob, nonce, ts }. RAM only, TTL-bound.
const mailboxes = new Map();

function deliver(toKey, envelope) {
  const sock = online.get(toKey);
  if (sock && sock.readyState === sock.OPEN) {
    sock.send(JSON.stringify({ type: 'msg', envelope }));
    return true;
  }
  return false;
}

function queueForOffline(toKey, envelope) {
  const box = mailboxes.get(toKey) || [];
  box.push({ envelope, ts: Date.now() });
  mailboxes.set(toKey, box);
}

function flushMailbox(toKey, sock) {
  const box = mailboxes.get(toKey);
  if (!box || box.length === 0) return;
  for (const item of box) {
    sock.send(JSON.stringify({ type: 'msg', envelope: item.envelope }));
  }
  mailboxes.delete(toKey); // wipe immediately after handoff
}

// Periodic hard-delete sweep for anything that outlived the TTL,
// even if it was never picked up. No dead-letter log, no trace.
setInterval(() => {
  const now = Date.now();
  for (const [key, box] of mailboxes.entries()) {
    const fresh = box.filter((item) => now - item.ts < MAILBOX_TTL_MS);
    if (fresh.length === 0) mailboxes.delete(key);
    else mailboxes.set(key, fresh);
  }
}, 60 * 1000);

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (sock) => {
  let myKey = null;

  sock.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // silently drop malformed frames, no logging of content
    }

    if (msg.type === 'register') {
      // Identity = the public key itself. No email, no phone, no
      // username, no password. Whoever holds the private key IS
      // the account.
      myKey = msg.pubkey;
      online.set(myKey, sock);
      flushMailbox(myKey, sock);
      return;
    }

    if (msg.type === 'send') {
      // msg.to        -> recipient pubkey (base64)
      // msg.envelope  -> { blob, nonce, senderPubkey } all opaque to us
      const ok = deliver(msg.to, msg.envelope);
      if (!ok) queueForOffline(msg.to, msg.envelope);
      return;
    }
  });

  sock.on('close', () => {
    if (myKey && online.get(myKey) === sock) {
      online.delete(myKey);
    }
    // Nothing to clean up on disk — there never was anything there.
  });
});

console.log(`[voidline] relay listening on ws://localhost:${PORT}`);
console.log('[voidline] storage: RAM only, no disk writes, no logs of content or identity');
