# Virus Records — License Panel

The panel that issues the keys unlocking the desktop app, and the audit trail
that shows where each key is being used. Runs standalone: no database server,
no external service. Deployed on Dokploy at **distro.virusrecord.com**.

## Deploy on Dokploy

1. **New Application → Docker (Dockerfile)**, repository = this repo,
   *Build path* = `license-panel`.
2. **Environment**

   | Variable | Required | What it does |
   |---|---|---|
   | `PANEL_PASSWORD` | yes | The password you sign in with. |
   | `PANEL_SECRET` | yes | Signs the admin session cookie. ≥ 16 random characters. |
   | `DATA_DIR` | no | Where keys + audit log are stored. Defaults to `/data`. |

3. **Volume** — mount a persistent volume at `/data`. Without it every
   redeploy wipes the issued keys.
4. **Domain** — `distro.virusrecord.com`, port `3000`, HTTPS on.
5. Health check path: `/api/health`.

The panel sets `noindex` and has no public pages: every route except the
app-facing API requires the password.

## What the app talks to

| Endpoint | Who calls it | Purpose |
|---|---|---|
| `POST /api/v1/activate` | desktop app | Trades a key for a device-bound token. Records IP + time. |
| `POST /api/v1/heartbeat` | desktop app | Periodic "is this still valid?". Records IP + time. |
| `POST /api/v1/spotify` | desktop app | Reports the Spotify identity the user consented to link. |

The desktop app points at the panel via `OCEAN_LICENSE_SERVER`
(default `https://distro.virusrecord.com`).

## Key types

| Type | Expiry | Devices |
|---|---|---|
| **Single use** | never | exactly 1 — the first computer to activate it |
| **Timed** | N days from the **first activation** (not from creation) | configurable, default 1 |
| **Unlimited** | never | configurable, `0` = unlimited |

A key sitting unused in a message never burns its days: the clock starts when
someone actually activates it.

## Spotting a shared key

Every activation and check-in stores the client IP (read from
`x-forwarded-for`, which Dokploy's proxy sets) and the time. A key is flagged
when it answers from 4+ distinct IPs or exceeds its device limit. From the key
page you can:

- **Block** one device (that computer stops working, the others keep going),
- **Release** a device slot (frees the seat so the key can move to a new machine),
- **Revoke** the whole key (every installation locks at its next check-in).

Locking is not instant: an app that is already running keeps working until its
next heartbeat (every 15 minutes, and once at every start).

## What is stored about a user

Only what the app's consent screen lists before anything is sent: Spotify user
id, display name, avatar URL, country, account type (free/premium), follower
count and e-mail. **Never** Spotify tokens, and no listening history. If the
user unlinks their account in the app, the stored identity is deleted here too.

## Backups

Copy the `/data` volume — `keys.json` (the keys) and `events.jsonl` (the audit
trail) are the whole database.
