'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ejsPath = path.join(__dirname, '../views/index.ejs');
const uiJsPath = path.join(__dirname, '../public/js/softphone-ui.js');
const coreJsPath = path.join(__dirname, '../public/js/softphone-core.js');

const ejsContent = fs.readFileSync(ejsPath, 'utf8');
const uiJsContent = fs.readFileSync(uiJsPath, 'utf8');
const coreJsContent = fs.readFileSync(coreJsPath, 'utf8');

test('1. Dedicated Ring Audio Element in DOM', () => {
    assert.match(ejsContent, /<audio id="ringAudio" autoplay playsinline><\/audio>/, 'ringAudio element exists in DOM');
    assert.match(ejsContent, /<audio id="remoteAudio" autoplay playsinline><\/audio>/, 'remoteAudio element exists in DOM');
});

test('2. Settings & Devices Modal Structure & Sub-Tabs in EJS', () => {
    // Assert modal sub-tabs exist
    assert.match(ejsContent, /id="settingsTabBtnAudio"/, 'Audio tab button exists');
    assert.match(ejsContent, /id="settingsTabBtnDsp"/, 'DSP tab button exists');
    assert.match(ejsContent, /id="settingsTabBtnCalls"/, 'Calls tab button exists');

    // Assert tab content panels exist
    assert.match(ejsContent, /id="settingsTabContentAudio"/, 'Audio tab panel exists');
    assert.match(ejsContent, /id="settingsTabContentDsp"/, 'DSP tab panel exists');
    assert.match(ejsContent, /id="settingsTabContentCalls"/, 'Calls tab panel exists');

    // Assert Audio Hardware controls exist
    assert.match(ejsContent, /id="audioInputSelect"/, 'Microphone input select exists');
    assert.match(ejsContent, /id="audioOutputSelect"/, 'Speaker output select exists');
    assert.match(ejsContent, /id="audioRingSelect"/, 'Separate Ring device select exists');
    assert.match(ejsContent, /id="ringVolumeSlider"/, 'Ringtone volume slider exists');
    assert.match(ejsContent, /id="ringVolumeVal"/, 'Ringtone volume percentage display exists');

    // Assert Audio Processing (DSP) checkboxes exist
    assert.match(ejsContent, /id="ecCheckbox"/, 'Echo cancellation checkbox exists');
    assert.match(ejsContent, /id="nsCheckbox"/, 'Noise suppression checkbox exists');
    assert.match(ejsContent, /id="agcCheckbox"/, 'Auto gain control checkbox exists');

    // Assert Calls & Network controls exist
    assert.match(ejsContent, /id="stunCheckbox"/, 'STUN enable checkbox exists');
    assert.match(ejsContent, /id="stunServerInput"/, 'STUN server input exists');
    assert.match(ejsContent, /id="singleCallCheckbox"/, 'Single call mode checkbox exists');
    assert.match(ejsContent, /id="callWaitingCheckbox"/, 'Call waiting checkbox exists');
    assert.match(ejsContent, /id="dtmfMethodSelect"/, 'DTMF method select exists');
});

test('3. Core Engine Ring Device & Volume API', () => {
    assert.match(coreJsContent, /setRingAudioElement\s*\(el\)\s*\{/);
    assert.match(coreJsContent, /setRingDevice\s*\(deviceId\)\s*\{/);
    assert.match(coreJsContent, /setRingVolume\s*\(val\)\s*\{/);
    assert.match(coreJsContent, /playTestRingChime\s*\(\)\s*\{/);
    assert.match(coreJsContent, /playCallWaitingBeep\s*\(\)\s*\{/);

    // Assert volume preserves 0 and uses nullish coalescing
    assert.match(coreJsContent, /Number\(val\)\s*\?\?\s*100/);
    assert.doesNotMatch(coreJsContent, /this\.ringVolume\s*\|\|\s*100/);
});

test('4. Core Engine WebRTC Constraints & DSP Control', () => {
    assert.match(coreJsContent, /echoCancellation:\s*\{\s*ideal:\s*this\.echoCancellation\s*\}/);
    assert.match(coreJsContent, /noiseSuppression:\s*\{\s*ideal:\s*this\.noiseSuppression\s*\}/);
    assert.match(coreJsContent, /autoGainControl:\s*\{\s*ideal:\s*this\.autoGainControl\s*\}/);
    assert.match(coreJsContent, /setAudioProcessing\s*\(\{/);
});

test('5. Core Engine STUN / ICE Configuration', () => {
    assert.match(coreJsContent, /getStunIceServers\s*\(\)\s*\{/);
    assert.match(coreJsContent, /setStunConfig\s*\(enabled,\s*server\)\s*\{/);
    // Assert pcConfig uses dynamic getStunIceServers()
    assert.match(coreJsContent, /iceServers:\s*this\.getStunIceServers\(\)/);
});

test('6. Core Engine Single Call Mode & Call Waiting Logic', () => {
    assert.match(coreJsContent, /setSingleCallMode\s*\(enabled\)\s*\{/);
    assert.match(coreJsContent, /setCallWaiting\s*\(enabled\)\s*\{/);
    assert.match(coreJsContent, /setDtmfMethod\s*\(method\)\s*\{/);

    // Assert incoming call terminates with 486 Busy Here if single call mode or no call waiting
    assert.match(coreJsContent, /this\.activeCalls\.size\s*>\s*0\s*&&\s*\(this\.singleCallMode\s*\|\|\s*!this\.callWaiting\)/);

    // Assert secondary call with Call Waiting active plays call waiting beep
    assert.match(coreJsContent, /if\s*\(this\.activeCalls\.size\s*>\s*1\)\s*\{\s*this\.playCallWaitingBeep\(\);/);
});

test('7. UI Controller Settings Synchronization & Device Binding', () => {
    assert.match(uiJsContent, /this\.dom\.ringAudio\s*=\s*document\.getElementById\('ringAudio'\)/);
    assert.match(uiJsContent, /this\.dom\.audioRingSelect\s*=\s*document\.getElementById\('audioRingSelect'\)/);
    assert.match(uiJsContent, /switchSettingsTab\s*\(tabName\)\s*\{/);
    assert.match(uiJsContent, /syncSettingsToUi\s*\(\)\s*\{/);
    assert.match(uiJsContent, /testRingOutput\s*\(\)\s*\{/);

    // Assert UI controller sends DTMF through core
    assert.match(uiJsContent, /this\.core\.sendDTMF\(call\.id,\s*k\)/);
});
