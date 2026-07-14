'use strict';

let currentPeer = null; // pubkey of active contact
let contacts = {}; // pubkey -> label
let myPublicKey = null;

const el = (id) => document.getElementById(id);

// ---- Unlock flow -------------------------------------------------------

el('unlock-btn').addEventListener('click', doUnlock);
el('passphrase').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doUnlock();
});

window.voidline.getDefaultServer().then((server) => {
  el('server-url').placeholder = server;
});

async function doUnlock() {
  const passphrase = el('passphrase').value;
  const server = el('server-url').value;
  el('unlock-error').textContent = '';

  if (!passphrase || passphrase.length < 4) {
    el('unlock-error').textContent = 'Passphrase must be at least 4 characters.';
    return;
  }

  el('unlock-btn').disabled = true;
  el('unlock-btn').textContent = 'Unlocking…';

  try {
    const result = await window.voidline.unlock(passphrase, server);
    myPublicKey = result.publicKey;
    contacts = result.contacts || {};
    el('mykey-value').textContent = myPublicKey;
    renderContactList();
    el('unlock-screen').classList.add('hidden');
    el('main-screen').classList.remove('hidden');
  } catch (err) {
    el('unlock-error').textContent = err.message || 'Failed to unlock.';
    el('unlock-btn').disabled = false;
    el('unlock-btn').textContent = 'Enter Voidline';
  }
}

// ---- Status updates -----------------------------------------------------

window.voidline.onStatus(({ connected }) => {
  const dot = el('status-dot');
  const text = el('status-text');
  if (connected) {
    dot.classList.add('online');
    text.textContent = 'connected';
  } else {
    dot.classList.remove('online');
    text.textContent = 'reconnecting…';
  }
});

// ---- Copy public key -----------------------------------------------------

el('copy-mykey-btn').addEventListener('click', () => {
  window.voidline.copyToClipboard(myPublicKey);
  const btn = el('copy-mykey-btn');
  const original = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = original; }, 1200);
});

// ---- Contacts -------------------------------------------------------------

function renderContactList() {
  const list = el('contact-list');
  list.innerHTML = '';
  Object.entries(contacts).forEach(([pubkey, label]) => {
    const li = document.createElement('li');
    li.className = 'contact-item' + (pubkey === currentPeer ? ' active' : '');
    li.textContent = label;
    li.addEventListener('click', () => selectContact(pubkey));
    list.appendChild(li);
  });
}

el('add-contact-btn').addEventListener('click', () => {
  el('contact-label').value = '';
  el('contact-pubkey').value = '';
  el('add-contact-modal').classList.remove('hidden');
  el('contact-label').focus();
});

el('cancel-contact-btn').addEventListener('click', () => {
  el('add-contact-modal').classList.add('hidden');
});

el('save-contact-btn').addEventListener('click', async () => {
  const label = el('contact-label').value.trim();
  const pubkey = el('contact-pubkey').value.trim();
  if (!label || !pubkey) return;
  contacts = await window.voidline.addContact(label, pubkey);
  renderContactList();
  el('add-contact-modal').classList.add('hidden');
  selectContact(pubkey);
});

async function selectContact(pubkey) {
  currentPeer = pubkey;
  renderContactList();
  el('empty-state').classList.add('hidden');
  el('chat-active').classList.remove('hidden');
  el('active-contact-label').textContent = contacts[pubkey];

  const history = await window.voidline.getHistory(pubkey);
  renderMessages(history);
  el('message-input').focus();
}

// ---- Messaging -------------------------------------------------------------

function renderMessages(history) {
  const list = el('message-list');
  list.innerHTML = '';
  history.forEach((m) => appendMessageToDOM(m));
  list.scrollTop = list.scrollHeight;
}

function appendMessageToDOM(m) {
  const list = el('message-list');
  const div = document.createElement('div');
  div.className = 'msg ' + m.direction;
  const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `${escapeHtml(m.text)}<span class="msg-time">${time}</span>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

el('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = el('message-input');
  const text = input.value.trim();
  if (!text || !currentPeer) return;
  input.value = '';

  const { entry } = await window.voidline.sendMessage(currentPeer, text);
  appendMessageToDOM(entry);
});

window.voidline.onIncomingMessage((data) => {
  contacts = data.contacts;
  if (!contacts[data.peerPubkey]) return;

  if (data.peerPubkey === currentPeer) {
    appendMessageToDOM(data);
  } else {
    renderContactList(); // new/unknown contact appeared, refresh names
  }
});
