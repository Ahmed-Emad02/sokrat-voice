# AGENTS.md

Guidance and operational gotchas for AI agents working in `sokrat-voice-main`
(`~/suite/voice` in WSL, `G:\suite\apps\sokrat-voice-main` on Windows).

> Environment map for all five repos / ports / WSL-VM-Windows access:
> [`../../ACCESS.md`](../../ACCESS.md).

---

## 1. What it is

**Sokrat VOICE** — a standalone WebRTC softphone & telephony engine for Asterisk
and Issabel PBX. Node.js + Express + JsSIP + Web Audio DSP.

- PJSIP WebRTC core, secure **DTLS-SRTP** audio over WebSocket (`wss://…/ws`).
- Early media (183 Session Progress + SDP) for carrier announcements.
- Real-time VU metering, gain staging, DTMF; multi-window `BroadcastChannel` lock.
- Bilingual AR/EN with RTL.
- `CRM_API_DOCUMENTATION.md` describes the REST surface the CRM calls.

```
sokrat-voice-main/
├── server.js          # everything (Express + AMI client + telephony)
├── public/  views/    # softphone UI (EJS)
├── systemd/sokrat-softphone.service
├── test/              # 6 suites, node --test
└── CRM_API_DOCUMENTATION.md
```

---

## 2. Where it runs

| | |
| --- | --- |
| **Dev** | WSL — `npm start`, then `http://localhost:8090` |
| **Prod** | Rocky VM at `/opt/sokrat-softphone` behind the PBX (`ssh rocky`) |

Port **`8090`** (`PORT` env, fallback `server.js:31`).

---

## 3. Commands & tests

```bash
npm start      # node server.js
npm test       # node --test --test-force-exit
```

| Test file | Covers |
| --- | --- |
| `crm-api.test.js` | CRM-facing REST endpoints |
| `server-endpoint.test.js` | HTTP route behaviour |
| `ringback-decline.test.js` | decline handling / ringback silencing |
| `login-screen.test.js`, `ui-modernization.test.js` | UI |
| `settings-devices.test.js` | device / settings screens |

> `--test-force-exit` is required: the AMI socket and timers keep the event loop
> alive after tests finish.

---

## 4. Gotchas (read before changing `server.js`)

- **`HOST` defaults to `127.0.0.1`** (`server.js:32`). Anything that must be
  reachable from a phone or the laptop's LAN **must** be started with `HOST=0.0.0.0`,
  otherwise it is localhost-only and unreachable from outside WSL.
- **Hard-coded DB credentials in a shell-out** (`server.js:113`):
  `/usr/bin/mysql -h 127.0.0.1 -u root -padmin -D asterisk -N -e "SELECT …"`
  → requires the `mysql` **client binary** on PATH, the `asterisk` DB local, and
  root/`admin`. If any is missing, the extension list silently returns empty.
  Do not "clean up" this password without updating the PBX too — it is shared with
  `sokrat-push-gateway-master`.
- **AMI defaults:** `AMI_HOST=127.0.0.1`, `AMI_PORT=5038`, `AMI_USER/PASS=admin`.
  Point these at the VM when developing from WSL.
- **`PORT 8443` special-case** (`server.js:89-90`): when the request host ends in
  `:8443` (or `x-forwarded-port` is 8443) the generated `wss` URL switches to `wss`.
  This is how the production softphone is served behind Apache on the VM.
- **CSP:** `ALLOWED_FRAME_ANCESTORS` env (default `'self' https: http:`) — the
  softphone is meant to be embedded by the dashboard on the VM.
- Reload/watch in prod requires the systemd unit, not a bare `node`.

---

## 5. Relationship to the rest of the suite

- **SIP/WebSocket peer** of `sokrat-mobile-main` (softphone app).
- Publishes/reads the same `asterisk` DB as `sokrat-push-gateway-master`.
- On the VM it fronts **Asterisk (`sokrat-voip-dev-main`)** on `:8088`/`:8089`
  and the standalone softphone on `:8443` — see `../../ACCESS.md` §3.

---

## 6. Production install (Rocky / Issabel)

From the README — service user, unit, then:

```bash
sudo cp systemd/sokrat-softphone.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now sokrat-softphone.service
```
