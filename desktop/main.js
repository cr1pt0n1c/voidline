'use strict';

const { app, BrowserWindow, ipcMain, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('./crypto');
const store = require('./store');

const DEFAULT_SERVER = 'wss://voidline-relay.onrender.com';
const MAX_BACKOFF_MS = 15000;

let mainWindow = null;
let ws = null;
let connected = false;
let backoff = 1000;
const outbox = [];

let identity = null;
let storageKey = null;
let dataDir = null;
let db = null;
let serverUrl = DEFAULT_SERVER;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0f0f14',
    title: 'Voidline',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  Menu.setApplicationMenu(null); // no File/Edit/View menu bar clutter for non-technical users
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function pushToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function connectRelay() {
  ws = new WebSocket(serverUrl);

  ws.on('open', () => {
    connected = true;
    backoff = 1000;
    ws.send(JSON.stringify({ type: 'register', pubkey: identity.publicKeyB64 }));
    pushToRenderer('status', { connected: true, serverUrl });
    while (outbox.length > 0 && connected) {
      ws.send(JSON.stringify(outbox.shift()));
    }
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
      return; // failed authentication, silently drop
    }

    if (!db.contacts[senderPubkey]) {
      db.contacts[senderPubkey] = senderPubkey.slice(0, 12);
    }
    const entry = { peerPubkey: senderPubkey, direction: 'in', text: plaintext, ts: Date.now() };
    db.messages.push(entry);
    store.saveStore(dataDir, storageKey, db);

    pushToRenderer('incoming-message', {
      ...entry,
      label: db.contacts[senderPubkey],
      contacts: db.contacts,
    });
  });

  ws.on('close', () => {
    connected = false;
    pushToRenderer('status', { connected: false, serverUrl });
    setTimeout(connectRelay, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  });

  ws.on('error', () => {
    // 'close' fires right after and handles the retry
  });
}

// ---- IPC handlers, called from the renderer via preload.js -----------

ipcMain.handle('unlock', async (_event, { passphrase, server }) => {
  await crypto.init();
  dataDir = path.join(app.getPath('userData'), 'identity');
  fs.mkdirSync(dataDir, { recursive: true });

  identity = await crypto.loadOrCreateIdentity(dataDir, passphrase);
  storageKey = store.deriveStorageKey(dataDir, passphrase);
  db = store.loadStore(dataDir, storageKey);

  serverUrl = server && server.trim() ? server.trim() : DEFAULT_SERVER;
  connectRelay();

  return { publicKey: identity.publicKeyB64, contacts: db.contacts, serverUrl };
});

ipcMain.handle('add-contact', (_event, { label, pubkey }) => {
  db.contacts[pubkey] = label;
  store.saveStore(dataDir, storageKey, db);
  return db.contacts;
});

ipcMain.handle('get-history', (_event, { pubkey }) => {
  return db.messages.filter((m) => m.peerPubkey === pubkey);
});

ipcMain.handle('send-message', (_event, { pubkey, text }) => {
  const { blob, nonce } = crypto.encryptForPeer(text, pubkey, identity.privateKey);
  const frame = {
    type: 'send',
    to: pubkey,
    envelope: { blob, nonce, senderPubkey: identity.publicKeyB64 },
  };
  if (connected) {
    ws.send(JSON.stringify(frame));
  } else {
    outbox.push(frame);
  }

  const entry = { peerPubkey: pubkey, direction: 'out', text, ts: Date.now() };
  db.messages.push(entry);
  store.saveStore(dataDir, storageKey, db);

  return { queued: !connected, entry };
});

ipcMain.handle('copy-to-clipboard', (_event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('get-default-server', () => DEFAULT_SERVER);
