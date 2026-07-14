# Voidline

**A minimal end-to-end encrypted chat prototype built around one idea: the server should know as little as possible.**

No email. No phone number. No account recovery questions. Your identity *is* a cryptographic keypair you generate locally, and the relay server that shuttles messages between people never sees plaintext, never stores conversation history, and deletes everything as soon as it's delivered.

This is an early, working prototype - not a polished app. It's built to be extended, and contributions/ideas are welcome.

## What it is

Voidline is a terminal-based chat client + a relay server, built on:

- **End-to-end encryption** (`crypto_box`: X25519 key exchange + XSalsa20-Poly1305), via [libsodium](https://libsodium.gitbook.io/doc/)
- **Keypair-based identity** - no signup, no personal info, ever
- **Local-only message history**, encrypted at rest with a key derived from your passphrase (Argon2id)
- **A relay server that stores nothing** - messages live in RAM only, and are deleted the moment they're delivered (or after 24h if the recipient never comes online)

## How it works

```
┌──────────┐                  ┌──────────┐                  ┌──────────┐
│  Alice   │                  │  Relay   │                  │   Bob    │
│          │  encrypted blob  │          │  encrypted blob  │          │
│ (client) │ ───────────────► │ (server) │ ───────────────► │ (client) │
│          │                  │          │                  │          │
│ SQLite,  │                  │  RAM     │                  │ SQLite,  │
│ encrypted│                  │  only,   │                  │ encrypted│
│ locally  │                  │  no logs │                  │ locally  │
└──────────┘                  └──────────┘                  └──────────┘
```

1. When you first run the client, it generates an X25519 keypair locally. Your **public key is your entire identity** - share it with someone (out-of-band, e.g. in person, over Signal, whatever) so they can message you.
2. Messages are encrypted on your device before they ever leave it. The relay server only ever sees `recipient's public key → encrypted blob` - it has no way to read the content.
3. Once delivered, the server forgets the message immediately. There's no conversation history sitting on any server, anywhere.
4. Your own copy of the conversation lives only on your device, in a local SQLite database, itself encrypted with a key derived from a passphrase you choose (via Argon2id - the same algorithm used for secure password hashing).

**What this means:** if the relay server were ever seized, subpoenaed, or hacked, there is nothing to hand over - no message content, no history, no way to link identities to real people.

## Honest limitations (this is v0.1)

- **No forward secrecy yet.** Messages are encrypted with a static keypair, not a ratcheting protocol like Signal's. If your private key ever leaks, past messages become readable retroactively. A Double Ratchet upgrade is the top item on the roadmap.
- **No contact verification.** Adding a contact just trusts whatever public key you type in, no built-in QR-code/safety-number verification yet, so it's currently vulnerable to a man-in-the-middle if you exchange keys over an insecure channel.
- **Your IP is visible to the relay** at the network level, even though the app itself stores no metadata. Full anonymity would need this run behind Tor.
- **One device per identity.** No multi-device sync yet.
- **Terminal-only.** No GUI or mobile app (yet).

## Quickstart

### 1. Clone the repo

```bash
git clone https://github.com/cr1pt0n1c/voidline.git
cd voidline
```

### 2. Install the client

```bash
cd client
npm install
```

### 3. Run it, pointed at the public relay

```bash
VOIDLINE_SERVER=wss://voidline-relay.onrender.com node client.js <your-name>
```

Replace `<your-name>` with any local profile name you want (e.g. `alice`) — it's just a label for your local identity files, nobody else sees it.

> The relay is hosted on a free tier and may take 30-60 seconds to wake up if nobody's used it recently. The client retries automatically - just wait a moment on first connect.

On first run you'll be asked for a **passphrase**. This encrypts your local identity and message history — pick something you'll remember, there is no recovery if you forget it.

You'll then see your public key printed, something like:
```
Your public key (share this out-of-band, e.g. QR code, to add contacts):
3qWtSP4rKSR6vXtndLx976-cgQ2xRPYKibVW1MZk0mc
```

**Share this with whoever you want to chat with**, and get theirs in return, through any channel you both trust.

## Usage

Once connected, you get a prompt (`voidline>`). Commands:

| Command | What it does |
|---|---|
| `/add <label> <pubkey>` | Add a contact under a memorable name |
| `/contacts` | List your saved contacts |
| `/to <label>` | Set the active chat |
| `/history` | Show the local, decrypted history with the active contact |
| `/quit` | Exit |

Anything else you type is sent as a message to whoever's currently active (`/to`).

### Example session

```bash
$ node client.js alice
Passphrase for this identity: ********

--- VOIDLINE ---
Your public key (share this out-of-band, e.g. QR code, to add contacts):
3qWtSP4rKSR6vXtndLx976-cgQ2xRPYKibVW1MZk0mc
----------------

[connected] relay at wss://voidline-relay.onrender.com, registered as 3qWtSP4rKSR6vXtn...

voidline> /add bob L2ULEnP4ZYC4LQ7a5VWQy_Be_2EPimF-7Lb7Ghya8TU
Added bob.
voidline> /to bob
Active chat -> bob
voidline> hey, this is encrypted end to end
```

## Running your own relay instead of the public one

If you'd rather not rely on the shared relay (or want to self-host for a group of friends), the server is dead simple to run yourself:

```bash
git clone https://github.com/cr1pt0n1c/voidline.git
cd voidline/server
npm install
node server.js
```

Then point any client at it:
```bash
VOIDLINE_SERVER=ws://localhost:8787 node client.js alice
```

It's also deployable for free, Render.com's free web service tier works with no credit card required (just connect this repo, set the root directory to `server`, build command `npm install`, start command `npm start`).

## Roadmap

- [ ] Double Ratchet (via `libsignal`) for forward secrecy
- [ ] QR-code contact exchange with safety-number verification
- [ ] Tor hidden-service support for the relay, to hide IP metadata too
- [ ] Multi-device linking
- [ ] Group chats
- [ ] A proper GUI

Contributions and issue reports welcome - this is an early, actively evolving project.

## License

MIT — see [LICENSE](./LICENSE).
