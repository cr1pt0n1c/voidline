# Voidline

A minimal, working prototype of a privacy-first chat app: end-to-end
encrypted, no email/phone accounts, no server-side history, no metadata
retention. This is a **functional MVP**, tested end-to-end — not a mockup.

## What's actually implemented (and tested)

- **Identity = keypair, not email/phone.** Each client generates an X25519
  keypair on first run. The base64 public key *is* the account.
- **End-to-end encryption** via `crypto_box` (X25519 + XSalsa20-Poly1305,
  libsodium's NaCl box construction).
- **Dumb relay server.** Only ever sees `recipient_pubkey -> encrypted_blob`.
  Delivers immediately if the recipient is online; otherwise queues in RAM
  (never disk) for up to 24h, then hard-deletes. Restarting the server wipes
  everything. No logs of content or identity.
- **Local-only history**, app-layer encrypted with `crypto_secretbox` under
  a key derived from your passphrase via **Argon2id** (`crypto_pwhash`).
  Verified: grepping the raw `.sqlite` file for message text finds nothing.
- **Identity file encrypted at rest** the same way — without the passphrase
  it's unusable ciphertext.
- **Auto-reconnect with backoff.** If the relay drops (free-tier sleep,
  redeploy, network blip), the client retries automatically and queues
  outgoing messages locally until it's back — important once the relay is
  running on a free host that isn't always-on.

## What this is *not* (yet)

Being upfront about the gap between "prototype" and "production":

- **No Double Ratchet / forward secrecy.** Each message reuses the same
  static X25519 keypair (like NaCl box, not Signal Protocol). If a private
  key ever leaks, *all* past traffic for that identity is retroactively
  readable. Production version should layer in `libsignal` for proper
  ratcheting and forward secrecy.
- **No contact verification / MITM protection.** `/add` trusts whatever
  pubkey you type in. Real deployment needs out-of-band verification
  (QR code exchange, safety-number comparison) — see the earlier
  discussion on invite links.
- **IP address is still visible to the relay** at the TCP layer. The
  *application* stores no metadata, but the transport layer isn't hidden.
  For real anonymity you'd front this with Tor (run the relay as a hidden
  service) or a mixnet.
- **No multi-device support.** One identity file = one device. Signal's
  approach (linked devices via a separate key-exchange step) is the
  reference design if you want this later.
- **No SQLCipher.** History encryption is app-layer (per-row), not
  full-database-file encryption. Good defense in depth already; swapping
  `better-sqlite3` for a SQLCipher-backed driver would encrypt the whole
  file too, including schema/table names.
- **No push notifications, no group chat, no file transfer.** Text only,
  1:1, while both sides run the client.

## Deploy the relay for free (so people don't need to run their own)

**Fly.io** is the best free option here — free allowance covers 1 always-on
shared VM, which is enough for this relay (it holds almost nothing in
memory). Render's free tier also works but sleeps after 15min idle, adding
a ~30-60s cold-start delay on the next connection — the client's
auto-reconnect (see below) handles that gracefully, so either is fine for
an early testing phase.

### Option A — Fly.io (recommended, stays awake)

```bash
brew install flyctl   # or see fly.io/docs/hands-on/install-flyctl
fly auth login
cd server
fly launch            # detects fly.toml, will ask you to confirm/rename the app
fly deploy
```

You'll get a URL like `wss://voidline-relay.fly.dev`. Give that to testers
via the `VOIDLINE_SERVER` env var (see below).

### Option B — Render.com (simpler UI, sleeps when idle)

1. Push this repo to GitHub (see below) first.
2. On [render.com](https://render.com) → New → Web Service → connect the repo,
   root directory `server/`.
3. Build command: `npm install`. Start command: `npm start`.
4. Render auto-sets `PORT`; `server.js` already respects it.
5. You'll get `https://your-app.onrender.com` — for WebSocket, testers connect
   to `wss://your-app.onrender.com`.

### Pointing clients at your deployed relay

```bash
VOIDLINE_SERVER=wss://voidline-relay.fly.dev node client.js alice
```

Or testers just export it once: `export VOIDLINE_SERVER=wss://...` in their shell profile.

## Publishing the client so people can try it with one command

Once you're ready for low-friction testing (no `git clone` needed):

```bash
cd client
npm login
npm publish --access public
```

Then anyone can run:
```bash
npx voidline-client alice
# or, since bin is set:
npx voidline alice
```

Until then, the GitHub clone + `npm install` path (see "Running it" above)
works fine for early testers who don't mind a couple of terminal commands.

## Pushing this to GitHub

```bash
cd voidline
git init
git add .
git commit -m "Initial Voidline prototype: E2E relay + local-encrypted client"
git branch -M main
git remote add origin https://github.com/<your-username>/voidline.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `.voidline-data/` (local
identities — never commit these), and log files.

For a public repo people will actually test, consider adding to the
README's top: a one-paragraph "what is this / why" (you already have that
context from this conversation), a short GIF or asciinema recording of two
terminals chatting, and a `CONTRIBUTING.md` once you're ready for PRs —
not needed for v0.1, but worth it once "postupně budu rozšiřovat
funkcionalitu" kicks in and other people start opening issues.



```bash
# terminal 1 — the relay
cd server
node server.js

# terminal 2 — Alice
cd client
node client.js alice

# terminal 3 — Bob
cd client
node client.js bob
```

In each client:
```
/add <label> <their-pubkey>     # exchange pubkeys out-of-band first!
/to <label>
<type anything to send>
/history
```

Each profile's data (identity, salts, local encrypted history) lives in
`client/.voidline-data/<profile>/` — delete that folder to wipe a profile
completely.

## Suggested next steps, roughly in priority order

1. Swap the crypto layer for `libsignal` (Double Ratchet) — this is the
   single biggest gap vs. a real secure messenger.
2. Add QR-code-based contact exchange with fingerprint verification.
3. Put the relay behind a Tor hidden service (`.onion`), or at minimum
   strip IP logging at whatever reverse proxy fronts it in production.
4. Add an explicit, user-triggered encrypted export/import for history
   (so reinstalling doesn't mean losing everything, without ever putting
   plaintext-adjacent backups on a server).
5. If you want multi-device: implement a linked-device flow, not
   server-side history sync.

## Files

```
voidline/
├── server/
│   └── server.js       # the whole relay — ~100 lines, read it, it's short
├── client/
│   ├── crypto.js        # identity, E2E encrypt/decrypt, local storage seal
│   ├── db.js             # SQLite wrapper, app-layer encrypted rows
│   └── client.js          # CLI: register, add contacts, send, history
└── README.md (this file)
```
