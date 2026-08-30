# Sokrat VOICE

**Sokrat VOICE** is a standalone WebRTC softphone & telephony engine for Asterisk and Issabel PBX. Built with Node.js, Express, JsSIP, and Web Audio DSP.

---

## Features

- **PJSIP WebRTC Core**: Secure DTLS-SRTP bidirectional audio over WebSocket (`wss://`).
- **Early Media Support**: Real-time GSM carrier announcement passthrough (183 Session Progress with SDP).
- **Audio DSP Engine**: Real-time VU meter analysis, input/output gain staging, DTMF generation.
- **Multi-Window Sync**: Single-tab active leadership lock via `BroadcastChannel` and `localStorage`.
- **Arabic & English Localization**: Native RTL support with typography fallback.
- **Automated Tests**: Unit test suite for call decline handling, ringback tone silencing, audio track lifecycle.

---

## Installation

```bash
# 1. Clone repository
git clone https://github.com/Ahmed-Emad02/sokrat-voice.git /opt/sokrat-softphone
cd /opt/sokrat-softphone

# 2. Install dependencies
npm install --production

# 3. Create service user & group
sudo useradd -r -s /sbin/nologin -d /opt/sokrat-softphone sokrat-softphone
sudo usermod -aG asterisk sokrat-softphone
sudo chown -R sokrat-softphone:sokrat-softphone /opt/sokrat-softphone

# 4. Install & start systemd service
sudo cp systemd/sokrat-softphone.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sokrat-softphone.service
```

---

## Running Tests

```bash
npm test
```

---

## License

ISC License - Sokrat VoIP Suite
