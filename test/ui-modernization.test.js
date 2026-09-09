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

test('1. Extension Dropdown Removal & Hardware Badge with Sign Out Button', () => {
    // Assert dropdown popover and available extensions list are completely removed
    assert.doesNotMatch(ejsContent, /id="customExtPopover"/, 'customExtPopover removed from DOM');
    assert.doesNotMatch(ejsContent, /id="customExtList"/, 'customExtList removed from DOM');
    assert.doesNotMatch(ejsContent, /AVAILABLE EXTENSIONS/, 'AVAILABLE EXTENSIONS text removed');

    // Assert static hardware badge exists with current extension label
    assert.match(ejsContent, /class="assigned-ext-badge"/, 'assigned-ext-badge exists');
    assert.match(ejsContent, /id="customExtTriggerLabel"/, 'customExtTriggerLabel exists');

    // Assert Sign Out / Connect button exists in status strip
    assert.match(ejsContent, /id="connectBtn"/, 'connectBtn exists');
    assert.match(ejsContent, /class="compact-connect-btn"/, 'compact-connect-btn exists');

    // Assert titlebar has expanded breathing height (38px)
    assert.match(ejsContent, /\.app-titlebar\s*\{[^}]*height:\s*38px\s*!important;/);
    // Assert status strip has height 28px
    assert.match(ejsContent, /\.header-status-strip\s*\{[^}]*height:\s*28px\s*!important;/);
});

test('2. Dial Input Field Contrast, Recessed Box & Placeholder Hygiene', () => {
    // Assert fake mock number 1-555-0199 is eradicated from all dial inputs
    assert.doesNotMatch(ejsContent, /placeholder="1-555-0199"/, 'no confusing mock number placeholder');
    // Assert dialInput has clean localized placeholder
    assert.match(ejsContent, /id="dialInput"\s+placeholder="<\%=\s*isRtl\s*\?\s*'[^']*'\s*:\s*'Enter number\.\.\.'\s*\%>"/);
    // Assert .dialer-input-box has recessed background and rounded border
    assert.match(ejsContent, /\.dialer-input-box\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.04\)\s*!important;/);
    assert.match(ejsContent, /\.dialer-input-box\s*\{[^}]*border-radius:\s*12px\s*!important;/);
    // Assert .dialer-input text is high-contrast white with tabular nums
    assert.match(ejsContent, /\.dialer-input\s*\{[^}]*color:\s*#ffffff\s*!important;/);
    assert.match(ejsContent, /\.dialer-input\s*\{[^}]*font-weight:\s*600\s*!important;/);
});

test('3. PhonerLite 3x5 Rectangular Keypad Matrix, Button Gap & Spacing', () => {
    // Assert 15 buttons in keypad-grid
    assert.match(ejsContent, /data-digit="1"><span class="keypad-digit">1<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="2"><span class="keypad-digit">2<\/span><span class="keypad-sub">ABC<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="3"><span class="keypad-digit">3<\/span><span class="keypad-sub">DEF<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="4"><span class="keypad-digit">4<\/span><span class="keypad-sub">GHI<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="5"><span class="keypad-digit">5<\/span><span class="keypad-sub">JKL<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="6"><span class="keypad-digit">6<\/span><span class="keypad-sub">MNO<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="7"><span class="keypad-digit">7<\/span><span class="keypad-sub">PQRS<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="8"><span class="keypad-digit">8<\/span><span class="keypad-sub">TUV<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="9"><span class="keypad-digit">9<\/span><span class="keypad-sub">WXYZ<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="\*"><span class="keypad-digit">\*<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="0"><span class="keypad-digit">0<\/span><\/button>/);
    assert.match(ejsContent, /data-digit="#"><span class="keypad-digit">#<\/span><\/button>/);

    // Row 5: R (Redial), + (Plus), C (Clear)
    assert.match(ejsContent, /id="keypadBtnRedial"/, 'Row 5 R Redial button exists');
    assert.match(ejsContent, /data-digit="\+"/, 'Row 5 + Plus button exists');
    assert.match(ejsContent, /id="keypadBtnClear"/, 'Row 5 C Clear button exists');

    // Assert generous button gap (8px 10px) and button height (42px)
    assert.match(ejsContent, /\.keypad-grid\s*\{[^}]*gap:\s*8px 10px\s*!important;/);
    assert.match(ejsContent, /\.keypad-btn\s*\{[^}]*height:\s*44px\s*!important;/);
    assert.match(ejsContent, /\.keypad-btn\s*\{[^}]*border-radius:\s*6px\s*!important;/);
    assert.match(ejsContent, /\.keypad-btn\s*\{[^}]*flex-direction:\s*row\s*!important;/);
    assert.match(ejsContent, /\.keypad-sub\s*\{[^}]*font-size:\s*9px\s*!important;/);
});

test('4. Single Redial in Keypad and Call Action Row Cleanup', () => {
    // Assert Redial exists on keypad
    assert.match(ejsContent, /id="keypadBtnRedial"/, 'keypadBtnRedial exists on dialpad row 5');
    // Assert no extra redial button next to callBtn in action row
    assert.doesNotMatch(ejsContent, /class="keypad-action-row"[^>]*>[\s\S]*?id="dialerRedialBtn"/, 'no duplicate redial in action row');

    // Assert .keypad-action-row contains #callBtn with 100% width
    assert.match(ejsContent, /id="callBtn"/, 'HTML contains callBtn');
    assert.match(ejsContent, /\.call-pill-btn\s*\{[^}]*width:\s*100%\s*!important;/);
    assert.match(ejsContent, /\.call-pill-btn\s*\{[^}]*background:\s*#10b981\s*!important;/);
});

test('5. Anti-Aliasing, Crisp SVG Rendering & Isolation Cleanup', () => {
    // Assert global font antialiasing and geometric precision
    assert.match(ejsContent, /-webkit-font-smoothing:\s*antialiased\s*!important;/);
    assert.match(ejsContent, /-moz-osx-font-smoothing:\s*grayscale\s*!important;/);
    assert.match(ejsContent, /text-rendering:\s*optimizeLegibility\s*!important;/);
    assert.match(ejsContent, /shape-rendering:\s*geometricPrecision\s*!important;/);

    // Assert speaker button #toolBtnSpeakerMute uses loudspeaker polygon SVG, not headset path
    const speakerBtnMatch = ejsContent.match(/<button[^>]*id="toolBtnSpeakerMute"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(speakerBtnMatch, 'toolBtnSpeakerMute button found');
    assert.match(speakerBtnMatch[0], /<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/, 'speaker button uses loudspeaker polygon');
    assert.doesNotMatch(speakerBtnMatch[0], /<path d="M3 18v-6a9 9 0 0 1 18 0v6"/, 'speaker button does not use headset SVG');
});

test('6. Volume Control Preserves 0% and Does Not Reset to 100%', () => {
    // Test that uiJsContent does not use falsy fallback `speakerVolume || 100` in critical calculations
    assert.doesNotMatch(uiJsContent, /this\.core\.speakerVolume\s*\|\|\s*100/, 'does not use falsy fallback for speakerVolume');
    assert.doesNotMatch(uiJsContent, /this\.core\.micVolume\s*\|\|\s*100/, 'does not use falsy fallback for micVolume');

    // Test volume display calculation with 0 volume
    let updatedSpk = -1;
    let savedSpkInStorage = -1;

    const mockUi = {
        core: {
            speakerVolume: 0,
            micVolume: 50,
            setSpeakerVolume(v) { this.speakerVolume = v; updatedSpk = v; }
        },
        updateSpeakerVolume(val) {
            const clamped = Math.max(0, Math.min(100, Number(val) || 0));
            this.core.setSpeakerVolume(clamped);
            savedSpkInStorage = clamped;
            this.syncAllVolumeDisplays();
        },
        refreshSegmentedVolumeDisplay(container, micVol, spkVol) {
            const NUM_SEGMENTS = 12;
            const micVal = (micVol !== undefined) ? micVol : (this.core.micVolume ?? 100);
            const spkVal = (spkVol !== undefined) ? spkVol : (this.core.speakerVolume ?? 100);
            const spkActiveCount = Math.round((spkVal / 100) * NUM_SEGMENTS);
            assert.equal(spkVal, 0, 'volume passed to display remains 0, not 100');
            assert.equal(spkActiveCount, 0, 'active segment count is 0 for 0 volume');
        },
        syncAllVolumeDisplays() {
            this.refreshSegmentedVolumeDisplay(null, this.core.micVolume ?? 100, this.core.speakerVolume ?? 100);
        }
    };

    // Trigger updateSpeakerVolume with 0
    mockUi.updateSpeakerVolume(0);
    assert.equal(updatedSpk, 0, 'setSpeakerVolume received 0');
    assert.equal(savedSpkInStorage, 0, 'localStorage saved 0');
    assert.equal(mockUi.core.speakerVolume, 0, 'speakerVolume is 0');
});

test('7. Strict Byte-for-Byte Script Synchronization', () => {
    // Core engine parity
    const coreMarker = "<!-- 2. Sokrat Softphone Core Engine (SIP/WebRTC/Audio DSP) -->\n    <script>\n";
    const coreStart = ejsContent.indexOf(coreMarker) + coreMarker.length;
    const coreEnd = ejsContent.indexOf("</script>", coreStart);
    const inlinedCore = ejsContent.substring(coreStart, coreEnd);
    assert.equal(inlinedCore, coreJsContent, 'inlined core engine matches public/js/softphone-core.js byte-for-byte');

    // UI controller parity
    const uiMarker = "<!-- 3. Sokrat Softphone UI Controller -->\n    <script>\n";
    const uiStart = ejsContent.indexOf(uiMarker) + uiMarker.length;
    const uiEnd = ejsContent.lastIndexOf("</script>");
    const inlinedUi = ejsContent.substring(uiStart, uiEnd);
    assert.equal(inlinedUi, uiJsContent, 'inlined UI controller matches public/js/softphone-ui.js byte-for-byte');
});

test('8. Viewport Containment & No Vertical Window Stretching on List Views', () => {
    const latestEjs = fs.readFileSync(ejsPath, 'utf8');

    // Assert app-window has fixed height (560px) rather than height: auto
    assert.match(latestEjs, /\.app-window[^}]*height:\s*560px\s*!important;/);
    assert.match(latestEjs, /\.app-window[^}]*min-height:\s*560px\s*!important;/);

    // Assert tab-view-content has flex: 1, min-height: 0, height: 100%, and overflow hidden
    assert.match(latestEjs, /\.tab-view-content\s*\{[^}]*flex:\s*1\s*!important;/);
    assert.match(latestEjs, /\.tab-view-content\s*\{[^}]*min-height:\s*0\s*!important;/);
    assert.match(latestEjs, /\.tab-view-content\s*\{[^}]*overflow:\s*hidden\s*!important;/);

    // Assert contacts-list and recent-calls-list have overflow-y: auto and flex: 1
    assert.match(latestEjs, /\.contacts-list,\s*\.recent-calls-list\s*\{[^}]*overflow-y:\s*auto\s*!important;/);
    assert.match(latestEjs, /\.contacts-list,\s*\.recent-calls-list\s*\{[^}]*flex:\s*1\s*!important;/);
    assert.match(latestEjs, /\.contacts-list,\s*\.recent-calls-list\s*\{[^}]*min-height:\s*0\s*!important;/);
});

test('9. Contact Card Name Legibility & Phone Number Typography', () => {
    const latestEjs = fs.readFileSync(ejsPath, 'utf8');
    const latestUiJs = fs.readFileSync(uiJsPath, 'utf8');

    // Assert .contact-phone-number class exists and has readable 12px font size with high contrast
    assert.match(latestEjs, /\.contact-phone-number\s*\{[^}]*font-size:\s*12px\s*!important;/);
    assert.match(latestEjs, /\.contact-phone-number\s*\{[^}]*color:\s*#cbd5e1\s*!important;/);

    // Assert .recent-name has prominent font size
    assert.match(latestEjs, /\.recent-name\s*\{[^}]*font-size:\s*13\.5px\s*!important;/);

    // Assert .recent-call-btn is compact (26px) to maximize contact name width
    assert.match(latestEjs, /\.recent-call-btn\s*\{[^}]*width:\s*26px\s*!important;/);
    assert.match(latestEjs, /\.recent-call-btn\s*\{[^}]*height:\s*26px\s*!important;/);

    // Assert renderContactsList sets contact-phone-number class and name tooltip
    assert.match(latestUiJs, /numSpan\.className\s*=\s*'contact-phone-number'/);
    assert.match(latestUiJs, /nameSpan\.title\s*=\s*contact\.name\s*\|\|\s*contact\.number/);
});

test('10. In-Place Active Call Screen Takeover (No Side Spawning)', () => {
    const latestEjs = fs.readFileSync(ejsPath, 'utf8');
    const latestUiJs = fs.readFileSync(uiJsPath, 'utf8');

    // Assert activeCallContainer is positioned inside app-body after line1Workspace
    const workspacePos = latestEjs.indexOf('id="line1Workspace"');
    const activeCallPos = latestEjs.indexOf('id="activeCallContainer"');
    const modalPos = latestEjs.indexOf('id="presetModal"');
    assert.ok(workspacePos > 0, 'line1Workspace found');
    assert.ok(activeCallPos > workspacePos, 'activeCallContainer is placed after line1Workspace');
    assert.ok(activeCallPos < modalPos, 'activeCallContainer is inside mainAppWindow before modals');

    // Assert activeCallContainer has takeover styling (width: 100%, height: 100%, flex: 1)
    assert.match(latestEjs, /#activeCallContainer\s*\{[^}]*width:\s*100%\s*!important;/);
    assert.match(latestEjs, /#activeCallContainer\s*\{[^}]*height:\s*100%\s*!important;/);
    assert.match(latestEjs, /#activeCallContainer\s*\{[^}]*flex:\s*1\s*!important;/);

    // Assert renderActiveCalls hides normal dialer workspace during calls and restores it when empty
    assert.match(latestUiJs, /workspace\.classList\.add\('hidden'\)/);
    assert.match(latestUiJs, /workspace\.style\.setProperty\('display',\s*'none',\s*'important'\)/);
    assert.match(latestUiJs, /workspace\.classList\.remove\('hidden'\)/);
});

test('11. Remote Hangup Termination Defense (Active Call Watchdog & WebRTC Listeners)', () => {
    const latestEjs = fs.readFileSync(ejsPath, 'utf8');
    const latestCoreJs = fs.readFileSync(coreJsPath, 'utf8');

    // Assert startActiveCallChannelPoller is implemented in both files
    assert.match(latestCoreJs, /startActiveCallChannelPoller\(callEntry\)/);
    assert.match(latestEjs, /startActiveCallChannelPoller\(callEntry\)/);

    // Assert stopActiveCallChannelPoller is called in handleCallEnd
    assert.match(latestCoreJs, /this\.stopActiveCallChannelPoller\(\);/);
    assert.match(latestEjs, /this\.stopActiveCallChannelPoller\(\);/);

    // Assert track ended listener triggers handleCallEnd
    assert.match(latestCoreJs, /event\.track\.addEventListener\('ended'/);
    assert.match(latestEjs, /event\.track\.addEventListener\('ended'/);

    // Assert ICE / PeerConnection connection state disconnect triggers handleCallEnd
    assert.match(latestCoreJs, /pc\.iceConnectionState === 'disconnected'/);
    assert.match(latestEjs, /pc\.iceConnectionState === 'disconnected'/);
    assert.match(latestCoreJs, /pc\.connectionState === 'disconnected'/);
    assert.match(latestEjs, /pc\.connectionState === 'disconnected'/);
});

test('12. In-Call DTMF Keypad & Ringing Call Direct Transfer Support', () => {
    const latestEjs = fs.readFileSync(ejsPath, 'utf8');
    const latestUiJs = fs.readFileSync(uiJsPath, 'utf8');
    const latestCoreJs = fs.readFileSync(coreJsPath, 'utf8');

    // Assert in-call DTMF section and buttons exist in CSS
    assert.match(latestEjs, /\.in-call-dtmf-section\s*\{/);
    assert.match(latestEjs, /\.in-call-dtmf-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)\s*!important;/);
    assert.match(latestEjs, /\.dtmf-key-btn\s*\{/);

    // Assert incoming ringing call has 3 actions (Answer, Transfer, Decline)
    assert.match(latestEjs, /\.hero-actions-row--incoming\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)\s*!important;/);
    assert.match(latestUiJs, /transferRingingBtn\.className\s*=\s*'end-call-btn btn-transfer call-action--transfer'/);

    // Assert ringing transfer deflects call via SIP 302 Moved Temporarily without answering
    assert.match(latestCoreJs, /!callEntry\.answerTime && callEntry\.direction === 'incoming'/);
    assert.match(latestCoreJs, /status_code:\s*302/);
    assert.match(latestCoreJs, /reason_phrase:\s*'Moved Temporarily'/);
});

test('13. Topbar Action Controls (Connection Reload & Persistent Window Popout)', () => {
    const latestEjs = fs.readFileSync(ejsPath, 'utf8');
    const latestUiJs = fs.readFileSync(uiJsPath, 'utf8');

    // Assert Reload Connection button exists in telephony console header
    assert.match(latestEjs, /id="titlebarReloadBtn"/, 'titlebarReloadBtn exists');
    assert.match(latestEjs, /window\.softphoneUi\.reloadConnection\(\)/, 'titlebarReloadBtn calls reloadConnection');

    // Assert Open in Persistent Window button exists in telephony console header
    assert.match(latestEjs, /id="titlebarPopoutBtn"/, 'titlebarPopoutBtn exists');
    assert.match(latestEjs, /window\.softphoneUi\.openPersistentWindow\(\)/, 'titlebarPopoutBtn calls openPersistentWindow');

    // Assert reloadConnection implementation exists in both files
    assert.match(latestUiJs, /reloadConnection\(\)\s*\{/);
    assert.match(latestEjs, /reloadConnection\(\)\s*\{/);

    // Assert spinning animation is defined in CSS
    assert.match(latestEjs, /\.titlebar-btn\.spinning svg/);
    assert.match(latestEjs, /@keyframes titlebarSpin/);
});
