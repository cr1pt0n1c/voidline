#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const crypto = require('./crypto');
const db = require('./db');

const SERVER_URL = process.env.VOIDLINE_SERVER || 'ws://localhost:8787';
const MAX_BACKOFF_MS = 15000;

async function loadOrCreateStorageKey(dataDir, passphrase) {
  const p = path.join(dataDir, 'storage.salt.json');
  if (fs.existsSync(p)) {
    const { salt } = JSON.parse(fs.readFileSync(p, 'utf8'));
    return crypto.deriveKey(passphrase, salt).key;
  }
  const { key, salt } = crypto.deriveKey(passphrase);
  fs.writeFileSync(p, JSON.stringify({ salt }), { mode: 0o600 });
  return key;
}

async function main() {
  await crypto.init();

  const profile = process.argv[2];
  if (!profile) {
    console.log('Usage: node client.js <profile-name>');
    console.log('  e.g. node client.js alice');
    process.exit(1);
  }

  const dataDir = path.join(__dirname, '.voidline-data', profile);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  const passphrase = await ask('Passphrase for this identity (remember it — nothing recovers it): ');
  const identity = await crypto.loadOrCreateIdentity(dataDir, passphrase);
  const storageKey = await loadOrCreateStorageKey(dataDir, passphrase);
  const database = db.openDb(dataDir);

  console.log('\n--- VOIDLINE ---');
  console.log('Your public key (share this out-of-band, e.g. QR code, to add contacts):');
  console.log(identity.publicKeyB64);
  console.log('----------------\n');

  let activePeer = null; // label of currently selected contact
  let ws = null;
  let connected = false;
  let backoff = 1000;
  const outbox = []; // queued sends while disconnected (e.g. free-tier server waking up)

  function pubkeyFor(label) {
    const contacts = db.listContacts(database);
    const c = contacts.find((c) => c.label === label);
    return c ? c.pubkey : null;
  }

  function flushOutbox() {
    while (outbox.length > 0 && connected) {
      ws.send(JSON.stringify(outbox.shift()));
    }
  }

  function sendFrame(frame) {
    if (connected) {
      ws.send(JSON.stringify(frame));
    } else {
      outbox.push(frame);
    }
  }

  function connect() {
    ws = new WebSocket(SERVER_URL);

    ws.on('open', () => {
      connected = true;
      backoff = 1000;
      ws.send(JSON.stringify({ type: 'register', pubkey: identity.publicKeyB64 }));
      console.log(`\n[connected] relay at ${SERVER_URL}, registered as ${identity.publicKeyB64.slice(0, 16)}...\n`);
      flushOutbox();
      rl.prompt();
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'msg') return;
      const { blob, nonce, senderPubkey } = msg.envelope;

      let plaintext;
      try {
        plaintext = crypto.decryptFromPeer(blob, nonce, senderPubkey, identity.privateKey);
      } catch {
        console.log('\n[!] Received a message that failed authentication — dropped.\n');
        rl.prompt();
        return;
      }

      const contacts = db.listContacts(database);
      const known = contacts.find((c) => c.pubkey === senderPubkey);
      const from = known ? known.label : senderPubkey.slice(0, 12) + '…';

      if (!known) {
        db.upsertContact(database, senderPubkey, senderPubkey.slice(0, 12));
      }

      db.saveMessage(database, storageKey, {
        peerPubkey: senderPubkey,
        direction: 'in',
        plaintext,
        ts: Date.now(),
      });

      console.log(`\n[${from}] ${plaintext}`);
      rl.prompt();
    });

    ws.on('close', () => {
      if (connected) {
        console.log(`\n[!] Lost connection to relay. Reconnecting in ${Math.round(backoff / 1000)}s...`);
        rl.prompt();
      }
      connected = false;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    });

    ws.on('error', () => {
      // 'close' fires right after 'error' for connection failures; let it handle retry.
    });
  }

  function printHelp() {
    console.log('Commands:');
    console.log('  /add <label> <pubkey>   add a contact (get their key out-of-band)');
    console.log('  /contacts               list contacts');
    console.log('  /to <label>             set active chat');
    console.log('  /history                show local history with active chat');
    console.log('  /quit                   exit\n');
    console.log('Anything else you type is sent as a message to the active chat.\n');
    console.log('Note: on a free-tier host the relay may take ~30-60s to wake up on');
    console.log('first connection. The client will keep retrying automatically.\n');
  }

  rl.setPrompt('voidline> ');
  printHelp();
  connect();

  rl.on('line', (line) => {
    const trimmed = line.trim();

    if (trimmed === '/quit') {
      if (ws) ws.close();
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/contacts') {
      const contacts = db.listContacts(database);
      if (contacts.length === 0) console.log('(no contacts yet)');
      contacts.forEach((c) => console.log(`  ${c.label} -> ${c.pubkey.slice(0, 20)}...`));
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('/add ')) {
      const parts = trimmed.split(' ');
      const label = parts[1];
      const pubkey = parts[2];
      if (!label || !pubkey) {
        console.log('usage: /add <label> <pubkey>');
      } else {
        db.upsertContact(database, pubkey, label);
        console.log(`Added ${label}.`);
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('/to ')) {
      const label = trimmed.split(' ')[1];
      if (!pubkeyFor(label)) {
        console.log(`Unknown contact "${label}". Use /add first.`);
      } else {
        activePeer = label;
        console.log(`Active chat -> ${label}`);
      }
      rl.prompt();
      return;
    }

    if (trimmed === '/history') {
      if (!activePeer) {
        console.log('No active chat. Use /to <label> first.');
        rl.prompt();
        return;
      }
      const peerKey = pubkeyFor(activePeer);
      const hist = db.loadHistory(database, storageKey, peerKey);
      if (hist.length === 0) console.log('(no messages yet)');
      hist.forEach((m) => {
        const who = m.direction === 'out' ? 'me' : activePeer;
        console.log(`  [${new Date(m.ts).toLocaleTimeString()}] ${who}: ${m.text}`);
      });
      rl.prompt();
      return;
    }

    if (trimmed.length === 0) {
      rl.prompt();
      return;
    }

    // Otherwise: treat as a message to the active peer.
    if (!activePeer) {
      console.log('No active chat. Use /add then /to <label> first.');
      rl.prompt();
      return;
    }

    const peerKey = pubkeyFor(activePeer);
    const { blob, nonce } = crypto.encryptForPeer(trimmed, peerKey, identity.privateKey);
    sendFrame({
      type: 'send',
      to: peerKey,
      envelope: { blob, nonce, senderPubkey: identity.publicKeyB64 },
    });
    if (!connected) console.log('(offline — message queued, will send once reconnected)');

    db.saveMessage(database, storageKey, {
      peerPubkey: peerKey,
      direction: 'out',
      plaintext: trimmed,
      ts: Date.now(),
    });

    rl.prompt();
  });
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
