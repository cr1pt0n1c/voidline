'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voidline', {
  unlock: (passphrase, server) => ipcRenderer.invoke('unlock', { passphrase, server }),
  addContact: (label, pubkey) => ipcRenderer.invoke('add-contact', { label, pubkey }),
  getHistory: (pubkey) => ipcRenderer.invoke('get-history', { pubkey }),
  sendMessage: (pubkey, text) => ipcRenderer.invoke('send-message', { pubkey, text }),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  getDefaultServer: () => ipcRenderer.invoke('get-default-server'),
  onIncomingMessage: (cb) => ipcRenderer.on('incoming-message', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
});
