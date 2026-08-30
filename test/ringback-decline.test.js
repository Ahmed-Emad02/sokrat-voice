const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const coreJsPath = path.join(__dirname, '../public/js/softphone-core.js');
const uiJsPath = path.join(__dirname, '../public/js/softphone-ui.js');
const cssPath = path.join(__dirname, '../public/css/softphone.css');
const ejsPath = path.join(__dirname, '../views/index.ejs');

const coreJsContent = fs.readFileSync(coreJsPath, 'utf8');
const uiJsContent = fs.readFileSync(uiJsPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const ejsContent = fs.readFileSync(ejsPath, 'utf8');

// Load SokratSoftphoneCore in simulated DOM environment
function createTestCore() {
    const context = {
        window: {
            location: { hostname: '127.0.0.1', protocol: 'http:', port: '8090' },
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        document: {
            documentElement: { lang: 'en' },
            addEventListener: () => {},
            removeEventListener: () => {},
            createElement: (tag) => {
                if (tag === 'audio') {
                    return {
                        autoplay: true,
                        playsInline: true,
                        srcObject: null,
                        pause: function() { this.paused = true; },
                        play: function() { return Promise.resolve(); }
                    };
                }
                return {};
            }
        },
        MediaStream: class {
            constructor(tracks = []) {
                this._tracks = tracks;
                this.active = true;
            }
            getTracks() {
                return this._tracks;
            }
            addTrack(track) {
                this._tracks.push(track);
            }
        },
        navigator: {
            mediaDevices: {
                enumerateDevices: async () => [],
                getUserMedia: async () => ({
                    getTracks: () => [{ stop: () => {}, kind: 'audio' }],
                    active: true
                })
            }
        },
        BroadcastChannel: class {
            constructor() {}
            postMessage() {}
            close() {}
            addEventListener() {}
            removeEventListener() {}
        },
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        },
        console: console
    };

    const fn = new Function('window', 'document', 'MediaStream', 'navigator', 'BroadcastChannel', 'localStorage', 'console',
        coreJsContent
    );

    fn(
        context.window,
        context.document,
        context.MediaStream,
        context.navigator,
        context.BroadcastChannel,
        context.localStorage,
        context.console
    );

    const SokratSoftphoneCore = context.window.SokratSoftphoneCore;
    return new SokratSoftphoneCore({ lineId: 'test_line', busName: 'test_bus', lockKey: 'test_lock' });
}

test('1. Core, UI, CSS & EJS Mirroring Parity for Ringback, Fonts and Call Button', () => {
    // Assert JetBrains Mono font is set across CSS variables in CSS and EJS
    assert.match(cssContent, /--font-main:\s*'JetBrains Mono'/);
    assert.match(ejsContent, /--font-main:\s*'JetBrains Mono'/);
    assert.match(cssContent, /--font-mono:\s*'JetBrains Mono'/);
    assert.match(ejsContent, /--font-mono:\s*'JetBrains Mono'/);

    // Assert both files map 603 / Decline / Busy / Unavailable in session.on('failed')
    assert.match(coreJsContent, /statusCode === 603 \|\| cause === 'Rejected' \|\| cause === 'Declined' \|\| cause === 'Decline'/);
    assert.match(ejsContent, /statusCode === 603 \|\| cause === 'Rejected' \|\| cause === 'Declined' \|\| cause === 'Decline'/);

    // Assert both files clean up remoteAudioEl srcObject and tracks in handleCallEnd
    assert.match(coreJsContent, /this\.remoteAudioEl\.srcObject\.getTracks\(\)\.forEach\(t\s*=>\s*\{\s*try\s*\{\s*t\.stop\(\);\s*\}\s*catch/);
    assert.match(ejsContent, /this\.remoteAudioEl\.srcObject\.getTracks\(\)\.forEach\(t\s*=>\s*\{\s*try\s*\{\s*t\.stop\(\);\s*\}\s*catch/);

    // Assert activeCalls check in makeCall (with consultCallPending allowance)
    assert.match(coreJsContent, /if\s*\(this\.activeCalls\.size\s*>\s*0\s*&&\s*!this\.consultCallPending\)\s*\{\s*throw new Error\('A call is already active on this line\.'\);\s*\}/);
    assert.match(ejsContent, /if\s*\(this\.activeCalls\.size\s*>\s*0\s*&&\s*!this\.consultCallPending\)\s*\{\s*throw new Error\('A call is already active on this line\.'\);\s*\}/);
    // Assert disabled styles for .call-pill-btn in CSS and EJS
    assert.match(cssContent, /\.call-pill-btn:disabled,\s*\.call-pill-btn\[disabled\]/);
    assert.match(ejsContent, /\.call-pill-btn:disabled,\s*\.call-pill-btn\[disabled\]/);

    // Assert UI controller disables callBtn when in call
    assert.match(uiJsContent, /this\.dom\.callBtn\.disabled\s*=\s*inCall\s*\|\|\s*\(this\.core\.regState\s*!==\s*'REGISTERED'\);/);
    assert.match(ejsContent, /this\.dom\.callBtn\.disabled\s*=\s*inCall\s*\|\|\s*\(this\.core\.regState\s*!==\s*'REGISTERED'\);/);
});

test('2. Synthetic Ringback Stops on Early Media Track Arrival and Confirmed Events', () => {
    const core = createTestCore();
    let ringbackStopCount = 0;
    core.stopRingback = () => { ringbackStopCount++; };

    const mockTrack = { kind: 'audio', readyState: 'live', stop: () => {} };
    const mockAudioEl = {
        srcObject: null,
        paused: false,
        pause() { this.paused = true; },
        play() { return Promise.resolve(); }
    };
    core.setRemoteAudioElement(mockAudioEl);

    // For outgoing calls, JsSIP creates session.connection BEFORE newRTCSession fires.
    // attachSessionListeners must bind to session.connection directly.
    const trackHandlers = [];
    const sessionEmitter = new EventEmitter();
    sessionEmitter.connection = {
        addEventListener: (event, handler) => {
            trackHandlers.push({ event, handler });
        }
    };

    const callEntry = {
        id: 'call_test_1',
        direction: 'outgoing',
        target: '102',
        status: 'progress'
    };

    core.attachSessionListeners(sessionEmitter, callEntry);

    // Verify track listener was registered on session.connection
    const trackListener = trackHandlers.find(h => h.event === 'track');
    assert.ok(trackListener, 'track listener must be registered on session.connection');

    // Simulate track event — early media audio arrives
    trackListener.handler({ streams: [], track: mockTrack });

    // Ringback must stop on track arrival — early media carrier audio replaces synthetic ringback
    assert.equal(ringbackStopCount, 1, 'stopRingback() must be called on track arrival (early media)');
    assert.ok(mockAudioEl.srcObject, 'remoteAudioEl.srcObject must be assigned the incoming stream');

    // SIP progress event should not call stopRingback again
    sessionEmitter.emit('progress', {
        response: { status_code: 180, reason_phrase: 'Ringing' }
    });
    assert.equal(ringbackStopCount, 1, 'stopRingback() should not be called again on progress');
    assert.equal(callEntry.status, 'progress');

    // Confirmed event also calls stopRingback (belt-and-suspenders)
    sessionEmitter.emit('confirmed');
    assert.equal(ringbackStopCount, 2, 'stopRingback() must be called on confirmed as well');
});

test('3. SIP 603 Declined / 486 Busy / 480 Unavailable Failure Handling & Ringback Silence', () => {
    const core = createTestCore();
    const toastEvents = [];
    const callEndedEvents = [];

    core.on('toast', (t) => toastEvents.push(t));
    core.on('callEnded', (e) => callEndedEvents.push(e));

    let ringbackStopCount = 0;
    core.stopRingback = () => { ringbackStopCount++; };

    const sessionEmitter = new EventEmitter();
    const callEntry = {
        id: 'call_test_3',
        direction: 'outgoing',
        target: '103',
        status: 'progress',
        answerTime: null
    };
    core.activeCalls.set(callEntry.id, callEntry);

    core.attachSessionListeners(sessionEmitter, callEntry);

    // Simulate SIP 603 Decline
    sessionEmitter.emit('failed', {
        cause: 'Rejected',
        response: { status_code: 603, reason_phrase: 'Decline' }
    });

    assert.ok(ringbackStopCount >= 1, 'stopRingback() must be called immediately on decline');
    assert.equal(toastEvents.length, 1);
    assert.equal(toastEvents[0].type, 'warning');
    assert.match(toastEvents[0].message, /Call Declined by 103/);
    assert.equal(core.activeCalls.has('call_test_3'), false, 'Call must be cleared from activeCalls');
    assert.equal(callEndedEvents.length, 1);
    assert.equal(callEndedEvents[0].outcome, 'rejected');

    // Test SIP 486 Busy
    const sessionEmitter2 = new EventEmitter();
    const callEntry2 = {
        id: 'call_test_4',
        direction: 'outgoing',
        target: '104',
        status: 'progress',
        answerTime: null
    };
    core.activeCalls.set(callEntry2.id, callEntry2);
    core.attachSessionListeners(sessionEmitter2, callEntry2);

    sessionEmitter2.emit('failed', {
        cause: 'Busy',
        response: { status_code: 486, reason_phrase: 'Busy Here' }
    });

    assert.match(toastEvents[1].message, /Extension 104 is Busy/);

    // Test SIP 480 Unavailable
    const sessionEmitter3 = new EventEmitter();
    const callEntry3 = {
        id: 'call_test_5',
        direction: 'outgoing',
        target: '105',
        status: 'progress',
        answerTime: null
    };
    core.activeCalls.set(callEntry3.id, callEntry3);
    core.attachSessionListeners(sessionEmitter3, callEntry3);

    sessionEmitter3.emit('failed', {
        cause: 'Unavailable',
        response: { status_code: 480, reason_phrase: 'Temporarily Unavailable' }
    });

    assert.match(toastEvents[2].message, /Extension 105 is Unavailable/);
    core.destroy();
});

test('4. Audio Stream and Track Teardown on handleCallEnd', () => {
    const core = createTestCore();
    let trackStopped = false;
    const mockTrack = {
        kind: 'audio',
        readyState: 'live',
        stop: () => { trackStopped = true; }
    };
    let paused = false;
    const mockAudioEl = {
        srcObject: {
            getTracks: () => [mockTrack]
        },
        pause: () => { paused = true; }
    };
    core.setRemoteAudioElement(mockAudioEl);

    let ringbackStopped = false;
    core.stopRingback = () => { ringbackStopped = true; };

    const callEntry = {
        id: 'call_test_teardown',
        direction: 'outgoing',
        target: '102',
        status: 'progress',
        answerTime: null
    };
    core.activeCalls.set(callEntry.id, callEntry);

    core.handleCallEnd(callEntry, 'declined');

    assert.equal(ringbackStopped, true, 'stopRingback must be executed on handleCallEnd');
    assert.equal(paused, true, 'remoteAudioEl must be paused when all calls end');
    assert.equal(trackStopped, true, 'all media tracks on remoteAudioEl must be stopped');
    assert.equal(mockAudioEl.srcObject, null, 'remoteAudioEl.srcObject must be reset to null');
    assert.equal(core.activeCalls.size, 0);
    core.destroy();
});

test('5. Prevent Multiple Outgoing Calls When Call is Active', () => {
    const core = createTestCore();
    core.ua = { isConnected: () => true };
    core.activeCalls.set('call_1', { id: 'call_1', status: 'active', target: '101' });

    assert.throws(
        () => core.makeCall('102'),
        /A call is already active on this line/,
        'makeCall must throw when another call is active'
    );
    core.destroy();
});

test('6. Microphone and Speaker Volume Controls over VU Meters', () => {
    const core = createTestCore();
    const mockAudioEl = {
        volume: 1.0,
        pause() {},
        play() { return Promise.resolve(); }
    };
    core.setRemoteAudioElement(mockAudioEl);

    // Speaker volume test
    let spkEvent = null;
    core.on('speakerVolumeChanged', (d) => { spkEvent = d; });
    core.setSpeakerVolume(75);
    assert.equal(core.speakerVolume, 75);
    assert.equal(mockAudioEl.volume, 0.75);
    assert.deepEqual(spkEvent, { volume: 75 });

    // Mic volume test
    let micEvent = null;
    core.on('micVolumeChanged', (d) => { micEvent = d; });
    core.setMicVolume(60);
    assert.equal(core.micVolume, 60);
    assert.deepEqual(micEvent, { volume: 60 });

    // Parity: check volume slider IDs in index.ejs and softphone-ui.js
    assert.match(ejsContent, /id="micVolumeSlider"/);
    assert.match(ejsContent, /id="speakerVolumeSlider"/);
    assert.match(uiJsContent, /id="line2MicVolumeSlider"/);
    assert.match(uiJsContent, /id="line2SpeakerVolumeSlider"/);

    // Parity: check slider CSS classes
    assert.match(cssContent, /\.vu-volume-slider/);
    assert.match(ejsContent, /\.vu-volume-slider/);

    core.destroy();
});

test('7. Blind and Attended Transfer Execution and State Integrity', () => {
    const core = createTestCore();
    core.ua = { isConnected: () => true, call: () => {} };
    core.activePreset = { sipDomain: '127.0.0.1' };

    let referTarget = null;
    let referOptions = null;
    let holdCalled = false;

    const mockSession = {
        refer: (target, opts) => {
            referTarget = target;
            referOptions = opts;
        },
        hold: () => { holdCalled = true; },
        unhold: () => { holdCalled = false; },
        terminate: () => {}
    };

    const callEntry = {
        id: 'call_transfer_orig',
        direction: 'inbound',
        target: '101',
        status: 'active',
        session: mockSession,
        isHeld: false
    };
    core.activeCalls.set(callEntry.id, callEntry);

    // Blind transfer test
    core.blindTransfer('call_transfer_orig', '102');
    assert.equal(referTarget, 'sip:102@127.0.0.1');
    assert.ok(referOptions && referOptions.eventHandlers, 'refer must include event handlers');

    // Attended transfer test — consultation call must NOT throw active call error
    assert.doesNotThrow(() => {
        core.attendedTransfer('call_transfer_orig', '103');
    }, 'attendedTransfer must initiate consultation call without throwing active calls guard');
    assert.equal(holdCalled, true, 'original call must be held during consultation');
    assert.ok(core.consultCallPending, 'consultCallPending must be set');

    // Cancel attended transfer
    core.cancelAttendedTransfer();
    assert.equal(core.consultCallPending, null, 'consultCallPending must be cleared on cancel');
    assert.equal(callEntry.isHeld, false, 'original call must be unheld on cancel');

    core.destroy();
});

test('8. Contacts Favoriting Pushes to Top and Supports Custom Reordering', () => {
    // Parity: check moveContact, reorderContactByIndex, draggable and grip handles in uiJs and ejs
    assert.match(uiJsContent, /moveContact\(id,\s*direction\)/);
    assert.match(ejsContent, /moveContact\(id,\s*direction\)/);
    assert.match(uiJsContent, /reorderContactByIndex\(fromIndex,\s*toIndex\)/);
    assert.match(ejsContent, /reorderContactByIndex\(fromIndex,\s*toIndex\)/);

    // Assert draggable attributes and contact-drag-handle classes
    assert.match(uiJsContent, /card\.draggable\s*=\s*true/);
    assert.match(ejsContent, /card\.draggable\s*=\s*true/);
    assert.match(uiJsContent, /contact-drag-handle/);
    assert.match(ejsContent, /contact-drag-handle/);

    // Assert CSS rules for drag-over and handles
    assert.match(cssContent, /\.contact-drag-handle/);
    assert.match(cssContent, /\.recent-card\.drag-over-top/);
    assert.match(cssContent, /\.recent-card\.drag-over-bottom/);

    // Assert favorite unshift logic
    assert.match(uiJsContent, /contacts\.unshift\(contact\);/);
    assert.match(ejsContent, /contacts\.unshift\(contact\);/);
});

test('9. Terminal-Style Dial History Seeking via Up/Down Arrows', () => {
    // Parity: check getDialedHistory and setupDialHistorySeeking in uiJs and ejs
    assert.match(uiJsContent, /getDialedHistory\(line\s*=\s*'line1'\)/);
    assert.match(ejsContent, /getDialedHistory\(line\s*=\s*'line1'\)/);
    assert.match(uiJsContent, /setupDialHistorySeeking\(inputEl,\s*line\s*=\s*'line1'\)/);
    assert.match(ejsContent, /setupDialHistorySeeking\(inputEl,\s*line\s*=\s*'line1'\)/);

    // Assert ArrowUp and ArrowDown event listeners
    assert.match(uiJsContent, /e\.key\s*===\s*'ArrowUp'/);
    assert.match(ejsContent, /e\.key\s*===\s*'ArrowUp'/);
    assert.match(uiJsContent, /e\.key\s*===\s*'ArrowDown'/);
    assert.match(ejsContent, /e\.key\s*===\s*'ArrowDown'/);

    // Assert selection range cursor placement
    assert.match(uiJsContent, /inputEl\.setSelectionRange\(inputEl\.value\.length,\s*inputEl\.value\.length\)/);
    assert.match(ejsContent, /inputEl\.setSelectionRange\(inputEl\.value\.length,\s*inputEl\.value\.length\)/);
});

test('10. Central Administrator Extension Policies and UI Feature Locks (Auto Answer & DND)', () => {
    // Parity: check fetchAndApplyExtensionPolicy and applyPolicyToUi in uiJs and ejs
    assert.match(uiJsContent, /fetchAndApplyExtensionPolicy\(extension\)/);
    assert.match(ejsContent, /fetchAndApplyExtensionPolicy\(extension\)/);
    assert.match(uiJsContent, /applyPolicyToUi\(policy\)/);
    assert.match(ejsContent, /applyPolicyToUi\(policy\)/);

    // Assert policy checks for force_on and force_off
    assert.match(uiJsContent, /policy\.auto_answer\s*===\s*'force_on'/);
    assert.match(ejsContent, /policy\.auto_answer\s*===\s*'force_on'/);
    assert.match(uiJsContent, /policy\.dnd\s*===\s*'force_on'/);
    assert.match(ejsContent, /policy\.dnd\s*===\s*'force_on'/);

    // Assert policy-locked and policy-disabled CSS classes
    assert.match(cssContent, /\.tool-icon-btn\.policy-locked/);
    assert.match(cssContent, /\.tool-icon-btn\.policy-disabled/);
    assert.match(ejsContent, /\.tool-icon-btn\.policy-locked/);
    assert.match(ejsContent, /\.tool-icon-btn\.policy-disabled/);
});
