# Sokrat Voice — CRM Telephony Integration & API Reference

A complete, production-grade guide for integrating **Sokrat Voice** (WebRTC softphone and telephony engine) with external CRM systems, helpdesks, and custom frontends.

---

## 📑 Table of Contents

- [1. Architecture & Dual-Layer Integration](#1-architecture--dual-layer-integration)
- [2. Call State Lifecycle Matrix](#2-call-state-lifecycle-matrix)
- [3. Server-Side REST API Reference](#3-server-side-rest-api-reference)
  - [3.1 Universal State & Presence Endpoints](#31-universal-state--presence-endpoints)
    - [`GET /api/call/state` (or `/status`)](#get-apicallstate)
    - [`GET /api/extension/status/:ext`](#get-apiextensionstatusext)
    - [`POST /api/extension/dnd`](#post-apiextensiondnd)
  - [3.2 Idle State Actions](#32-idle-state-actions)
    - [`POST /api/call/originate` (or `/dial`)](#post-apicalloriginate)
  - [3.3 Incoming Call State Actions](#33-incoming-call-state-actions)
    - [`POST /api/call/answer`](#post-apicallanswer)
    - [`POST /api/call/reject` (or `/decline`)](#post-apicallreject)
    - [`POST /api/call/redirect` (or `/forward`)](#post-apicallredirect)
  - [3.4 Outgoing Ringing State Actions](#34-outgoing-ringing-state-actions)
    - [`POST /api/call/cancel`](#post-apicallcancel)
  - [3.5 Active Call (In-Call) Actions](#35-active-call-in-call-actions)
    - [`POST /api/call/hangup`](#post-apicallhangup)
    - [`POST /api/call/hold`](#post-apicallhold)
    - [`POST /api/call/unhold` (or `/resume`)](#post-apicallunhold)
    - [`POST /api/call/mute`](#post-apicallmute)
    - [`POST /api/call/unmute`](#post-apicallunmute)
    - [`POST /api/call/dtmf`](#post-apicalldtmf)
    - [`POST /api/call/transfer`](#post-apicalltransfer)
    - [`POST /api/call/record`](#post-apicallrecord)
- [4. Client-Side Iframe & postMessage API](#4-client-side-iframe--postmessage-api)
  - [4.1 Embedding in an Iframe](#41-embedding-in-an-iframe)
  - [4.2 Inbound Control Commands](#42-inbound-control-commands)
  - [4.3 Outbound State Events](#43-outbound-state-events)
  - [4.4 Frontend Code Example (JavaScript / React)](#44-frontend-code-example-javascript--react)
- [5. Testing with the Built-in PJSIP Extension](#5-testing-with-the-built-in-pjsip-extension)

---

## 1. Architecture & Dual-Layer Integration

Sokrat Voice provides two complementary integration layers:

```text
 ┌──────────────────────────────────────────────────────────────┐
 │                      YOUR CRM APPLICATION                    │
 ├──────────────────────────────┬───────────────────────────────┤
 │     CRM Backend / Server     │    CRM Frontend (Browser)     │
 └──────────────┬───────────────┴───────────────┬───────────────┘
                │ HTTP REST                     │ postMessage /
                │ (JSON API)                    │ BroadcastChannel
                ▼                               ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                 SOKRAT VOICE ENGINE (Node.js)                │
 │    - Express REST API (Port 8090 / /phone/api/...)           │
 │    - JsSIP WebRTC Engine & Audio DSP                         │
 └──────────────────────────────┬───────────────────────────────┘
                                │ Asterisk AMI / WebSockets
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                ASTERISK 18 / ISSABEL PBX CORE                │
 │    - PJSIP WebRTC Endpoints (Extension 150)                  │
 │    - SIP Hardware Phones (Cisco 7945G, Yealink, etc.)        │
 │    - GSM Cellular Dongles (dongle0, dongle1)                 │
 └──────────────────────────────────────────────────────────────┘
```

1. **Server-Side REST API**: Use this for server-to-server workflows (lead screen-pop, CRM click-to-call buttons, auto-dialers, analytics dashboards, supervisor call controls). Accessible at `http://<PBX_IP>:8090/api/...` or over HTTPS at `https://<PBX_HOST>/phone/api/...`.
2. **Client-Side Iframe Bridge**: Use this when embedding Sokrat Voice inside your web CRM using an `<iframe>` or popup. Controls the active audio and WebRTC session directly in the agent's browser via standard `window.postMessage`.

---

## 2. Call State Lifecycle Matrix

| Telephony State | Possible Transitions | Valid CRM Actions |
| :--- | :--- | :--- |
| **`IDLE`** | → `RINGING_OUTGOING`, `RINGING_INCOMING` | `originate` / `dial`, `dnd`, `status` |
| **`RINGING_INCOMING`** | → `IN_CALL`, `IDLE` | `answer`, `reject` / `decline`, `redirect` / `forward` |
| **`RINGING_OUTGOING`** | → `IN_CALL`, `IDLE` | `cancel`, `status` |
| **`IN_CALL`** | → `HELD`, `IDLE` | `hangup`, `hold`, `mute`, `unmute`, `dtmf`, `transfer`, `record` |
| **`HELD`** | → `IN_CALL`, `IDLE` | `unhold` / `resume`, `hangup`, `transfer` |

---

## 3. Server-Side REST API Reference

All requests accept and return standard `application/json`.
Every endpoint is accessible under both `/api/...` and `/phone/api/...`.

---

### 3.1 Universal State & Presence Endpoints

#### `GET /api/call/state`
Returns the exact real-time call and channel state for a specified extension or channel.

* **Query Parameters:**
  * `ext` (string, optional): Extension number (e.g. `150` or `101`).
  * `channel` (string, optional): Specific Asterisk channel identifier.
* **Sample Request:**
  ```bash
  curl -s "http://127.0.0.1:8090/api/call/state?ext=150"
  ```
* **Sample Response (Idle State):**
  ```json
  {
    "success": true,
    "extension": "150",
    "state": "IDLE",
    "active": false,
    "channel": null,
    "bridgedChannel": null,
    "callId": null,
    "duration": 0,
    "direction": null,
    "callerNumber": null,
    "destination": null,
    "channels": []
  }
  ```
* **Sample Response (Active Call State):**
  ```json
  {
    "success": true,
    "extension": "150",
    "state": "IN_CALL",
    "active": true,
    "channel": "PJSIP/150-0000000a",
    "bridgedChannel": "Dongle/dongle0-0100000004",
    "callId": "1790683888.312",
    "duration": 48,
    "direction": "outbound",
    "callerNumber": "150",
    "destination": "01011719380",
    "recording": true,
    "channels": [
      {
        "channel": "PJSIP/150-0000000a",
        "stateCode": "6",
        "stateName": "UP",
        "duration": 48
      }
    ]
  }
  ```

---

#### `GET /api/extension/status/:ext`
Returns registration, endpoint technology, DND status, hardware IP, and current active call summary.

* **Sample Request:**
  ```bash
  curl -s "http://127.0.0.1:8090/api/extension/status/150"
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "extension": "150",
    "technology": "pjsip",
    "registered": true,
    "dnd": false,
    "state": "IDLE",
    "useragent": "JsSIP 3.10.1",
    "ip": "192.168.100.96",
    "activeCall": null
  }
  ```

---

#### `POST /api/extension/dnd`
Toggles or explicitly sets Do Not Disturb (DND) for an extension.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "enabled": true
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "extension": "150",
    "dnd": true,
    "message": "Do Not Disturb enabled"
  }
  ```

---

### 3.2 Idle State Actions

#### `POST /api/call/originate` (Alias: `/api/call/dial`)
Initiates an outbound call from an extension to a destination number. Automatically sets auto-answer headers so the agent's WebRTC or SIP phone connects seamlessly.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "destination": "01011719380",
    "callerId": "150",
    "timeout": 30000,
    "autoAnswer": true
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Call origination dispatched successfully",
    "extension": "150",
    "destination": "01011719380",
    "technology": "PJSIP"
  }
  ```

---

### 3.3 Incoming Call State Actions

#### `POST /api/call/answer`
Answers an incoming ringing call for the specified extension or channel.

* **Request Body:**
  ```json
  {
    "extension": "150"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Answer command dispatched",
    "channel": "PJSIP/150-0000000b",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/reject` (Alias: `/api/call/decline`)
Declines an incoming ringing call, sending a SIP 603 Busy/Decline signal to the caller.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "reason": "busy"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Incoming call rejected / declined successfully",
    "channel": "PJSIP/150-0000000b",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/redirect` (Alias: `/api/call/forward`)
Deflects / forwards an incoming ringing call to another destination (e.g. another agent or queue) without answering.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "destination": "102"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Call redirected to 102",
    "channel": "PJSIP/150-0000000b",
    "destination": "102",
    "extension": "150"
  }
  ```

---

### 3.4 Outgoing Ringing State Actions

#### `POST /api/call/cancel`
Cancels an outbound call attempt before the callee answers.

* **Request Body:**
  ```json
  {
    "extension": "150"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Outgoing call canceled successfully",
    "channel": "PJSIP/150-0000000c",
    "extension": "150"
  }
  ```

---

### 3.5 Active Call (In-Call) Actions

#### `POST /api/call/hangup`
Terminates an active call.

* **Request Body:**
  ```json
  {
    "extension": "150"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Call terminated successfully",
    "channel": "PJSIP/150-0000000d",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/hold`
Puts the active call on hold.

* **Request Body:**
  ```json
  {
    "extension": "150"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Call placed on hold",
    "held": true,
    "channel": "PJSIP/150-0000000d",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/unhold` (Alias: `/api/call/resume`)
Resumes a call currently on hold.

* **Request Body:**
  ```json
  {
    "extension": "150"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Call resumed from hold",
    "held": false,
    "channel": "PJSIP/150-0000000d",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/mute` & `POST /api/call/unmute`
Mutes or unmutes the audio stream on an active channel.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "direction": "in"
  }
  ```
  *(direction options: `"in"` (microphone), `"out"` (speaker), or `"all"`)*
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Audio muted (in)",
    "muted": true,
    "direction": "in",
    "channel": "PJSIP/150-0000000d",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/dtmf`
Plays dual-tone multi-frequency (DTMF) digits into the active call.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "digits": "1234#"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Sent DTMF [1234#]",
    "digits": "1234#",
    "channel": "PJSIP/150-0000000d",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/transfer`
Performs an immediate blind transfer of the connected caller to another destination.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "destination": "102"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "message": "Call successfully transferred to 102",
    "channel": "Dongle/dongle0-0100000004",
    "destination": "102",
    "extension": "150"
  }
  ```

---

#### `POST /api/call/record`
Dynamically starts or stops MixMonitor call recording on the active channel.

* **Request Body:**
  ```json
  {
    "extension": "150",
    "action": "start"
  }
  ```
* **Sample Response:**
  ```json
  {
    "success": true,
    "recording": true,
    "action": "start",
    "file": "/var/spool/asterisk/monitor/crm-1790683888312-150.wav",
    "channel": "PJSIP/150-0000000d"
  }
  ```

---

## 4. Client-Side Iframe & postMessage API

When Sokrat Voice is embedded inside your web CRM, your CRM frontend can control calls directly via standard DOM messages.

### 4.1 Embedding in an Iframe
```html
<iframe 
    id="sokratPhone" 
    src="https://pbx.yourcompany.com/phone/?lang=en" 
    allow="microphone; autoplay" 
    style="width: 380px; height: 560px; border: none; border-radius: 12px;">
</iframe>
```

---

### 4.2 Inbound Control Commands
Send messages to the iframe using `iframeEl.contentWindow.postMessage(message, '*')`:

| Action | Payload Syntax |
| :--- | :--- |
| **Dial / Click-to-Call** | `{ type: "sokrat.voice.dial", number: "01011719380", autoCall: true }` |
| **Answer Call** | `{ type: "sokrat.voice.answer" }` |
| **Reject / Decline** | `{ type: "sokrat.voice.reject" }` |
| **Cancel Outbound** | `{ type: "sokrat.voice.cancel" }` |
| **Hangup** | `{ type: "sokrat.voice.hangup" }` |
| **Hold** | `{ type: "sokrat.voice.hold" }` |
| **Unhold / Resume** | `{ type: "sokrat.voice.unhold" }` |
| **Mute Mic** | `{ type: "sokrat.voice.mute" }` |
| **Unmute Mic** | `{ type: "sokrat.voice.unmute" }` |
| **Send DTMF** | `{ type: "sokrat.voice.dtmf", digits: "123#" }` |
| **Blind Transfer** | `{ type: "sokrat.voice.transfer", destination: "102" }` |
| **Toggle DND** | `{ type: "sokrat.voice.dnd", enabled: true }` |
| **Query State** | `{ type: "sokrat.voice.get_state" }` |

---

### 4.3 Outbound State Events
Listen in your CRM window for real-time events emitted by Sokrat Voice:

```javascript
window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.type) return;

    switch (data.type) {
        case 'sokrat.voice.ready':
            console.log('Phone initialized and ready');
            break;

        case 'sokrat.voice.incoming':
            console.log('Incoming call from:', data.payload.phone, 'Call ID:', data.payload.callId);
            // Trigger CRM Lead Pop Screen!
            break;

        case 'sokrat.voice.call_state':
            console.log('Call state changed:', data.payload.state); // 'ringing', 'in_call', 'ended'
            break;

        case 'sokrat.voice.state':
            console.log('Current full phone state:', data.payload);
            break;
    }
});
```

---

### 4.4 Frontend Code Example (JavaScript / React)

```javascript
// Click-to-Call from a Lead Card in your CRM
function dialLead(phoneNumber) {
    const iframe = document.getElementById('sokratPhone');
    if (!iframe || !iframe.contentWindow) return;

    iframe.contentWindow.postMessage({
        type: 'sokrat.voice.dial',
        number: phoneNumber,
        autoCall: true
    }, '*');
}

// Answer incoming call from CRM Header
function answerIncomingCall() {
    const iframe = document.getElementById('sokratPhone');
    iframe.contentWindow.postMessage({ type: 'sokrat.voice.answer' }, '*');
}

// Hangup active call from CRM Floating Toolbar
function hangupCall() {
    const iframe = document.getElementById('sokratPhone');
    iframe.contentWindow.postMessage({ type: 'sokrat.voice.hangup' }, '*');
}
```

---

## 5. Testing with the Built-in PJSIP Extension

Sokrat Voice comes pre-configured with a dedicated WebRTC PJSIP extension: **`150`** (Secret: `sss333`).

### 1. Verification Checklist

1. **Verify Extension in Asterisk:**
   ```bash
   asterisk -rx "pjsip show endpoint 150"
   ```
2. **Query Extension Status via REST:**
   ```bash
   curl -s "http://127.0.0.1:8090/api/extension/status/150"
   ```
3. **Test Call Origination to Extension 101 (Cisco Handset):**
   ```bash
   curl -s -X POST "http://127.0.0.1:8090/api/call/originate" \
     -H "Content-Type: application/json" \
     -d '{"extension":"150","destination":"101"}'
   ```
4. **Query Active Call State while Ringing:**
   ```bash
   curl -s "http://127.0.0.1:8090/api/call/state?ext=150"
   ```
5. **Cancel the Outbound Ringing Call:**
   ```bash
   curl -s -X POST "http://127.0.0.1:8090/api/call/cancel" \
     -H "Content-Type: application/json" \
     -d '{"extension":"150"}'
   ```
