const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ejsPath = path.join(__dirname, '../views/index.ejs');
const cssPath = path.join(__dirname, '../public/css/softphone.css');
const jsPath = path.join(__dirname, '../public/js/softphone-ui.js');

const ejsContent = fs.readFileSync(ejsPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

test('1. Button Shutter Animation & Rogue Pseudo-Elements Removal', () => {
    [
        { name: 'views/index.ejs', content: ejsContent },
        { name: 'public/css/softphone.css', content: cssContent }
    ].forEach(({ name, content }) => {
        // Generic button must NOT be in shutter selector
        assert.doesNotMatch(content, /button,\s*a\.btn-link,\s*\.shutter-btn/, `${name}: generic button should not be in shutter selector`);
        assert.doesNotMatch(content, /button::before,\s*a\.btn-link::before,\s*\.shutter-btn::before/, `${name}: generic button::before should not be in shutter selector`);

        // transform: scaleX(0) at rest, scaleX(1) on hover
        assert.match(content, /\.shutter-btn::before[\s\S]*?transform:\s*scaleX\(0\)/, `${name}: shutter ::before rest state must be scaleX(0)`);
        assert.match(content, /\.shutter-btn:hover::before[\s\S]*?transform:\s*scaleX\(1\)/, `${name}: shutter hover state must be scaleX(1)`);

        // Rogue button:not(...) overlay must be deleted
        assert.doesNotMatch(content, /button:not\(\.btn-primary\):not\(\.btn-success\)/, `${name}: rogue button:not(...) red overlay must be deleted`);

        // Utility buttons must explicitly clear pseudo-elements
        assert.match(content, /\.titlebar-btn::before,\s*\.sub-nav-tab::before,\s*\.header-action-btn::before,\s*\.clear-input-btn::before[\s\S]*?display:\s*none\s*!important/, `${name}: titlebar and utility buttons clear pseudo-elements`);
    });
});

test('2. Dial Console Layout, Keypad Spacing & Header Controls', () => {
    [
        { name: 'views/index.ejs', content: ejsContent },
        { name: 'public/css/softphone.css', content: cssContent }
    ].forEach(({ name, content }) => {
        // Body layout and overflow
        assert.match(content, /body\s*\{[^}]*padding:\s*12px 8px;/, `${name}: body padding 12px 8px`);
        assert.match(content, /body\s*\{[^}]*overflow-y:\s*auto;/, `${name}: body overflow-y auto`);
        assert.match(content, /body\s*\{[^}]*display:\s*flex;/, `${name}: body display flex`);

        // .app-window dimensions
        assert.match(content, /\.app-window\s*\{[^}]*max-height:\s*calc\(100vh - 24px\);/, `${name}: app-window max-height`);
        assert.match(content, /\.app-window\s*\{[^}]*margin:\s*auto 0;/, `${name}: app-window margin: auto 0`);
        assert.match(content, /\.app-window\s*\{[^}]*min-height:\s*auto;/, `${name}: app-window min-height auto`);

        // Workspace header and status strip
        assert.match(content, /\.workspace-header\s*\{[^}]*flex-wrap:\s*nowrap/, `${name}: workspace-header flex-wrap nowrap`);
        assert.match(content, /\.workspace-header\s*\{[^}]*min-height:\s*48px;/, `${name}: workspace-header min-height 48px`);
        assert.match(content, /\.header-status-strip\s*\{[^}]*flex-wrap:\s*nowrap/, `${name}: header-status-strip flex-wrap nowrap`);
        assert.match(content, /\.header-status-strip select\s*\{[^}]*font-family:\s*var\(--font-mono\);/, `${name}: header-status-strip select font`);

        // Dialer column and keypad layout
        assert.match(content, /\.dialer-col\s*\{[^}]*flex-direction:\s*column;/, `${name}: dialer-col flex-direction`);
        assert.match(content, /\.dialer-col\s*\{[^}]*gap:\s*12px;/, `${name}: dialer-col gap 12px`);
        assert.match(content, /\.dialer-col\s*\{[^}]*max-width:\s*440px;/, `${name}: dialer-col max-width 440px`);
        assert.match(content, /\.dialer-input-box\s*\{[^}]*margin-bottom:\s*0;/, `${name}: dialer-input-box margin-bottom 0`);
        assert.match(content, /\.keypad-grid\s*\{[^}]*display:\s*grid;/, `${name}: keypad-grid display grid`);
        assert.match(content, /\.keypad-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\);/, `${name}: keypad-grid 3 columns`);
        assert.match(content, /\.keypad-grid\s*\{[^}]*gap:\s*6px;/, `${name}: keypad-grid gap 6px`);
        assert.match(content, /\.keypad-grid\s*\{[^}]*margin-bottom:\s*0;/, `${name}: keypad-grid margin-bottom 0`);
        assert.match(content, /\.keypad-btn\s*\{[^}]*min-height:\s*48px;/, `${name}: keypad-btn min-height 48px`);
        assert.match(content, /\.keypad-btn\s*\{[^}]*padding:\s*10px 0;/, `${name}: keypad-btn padding 10px 0`);
        assert.match(content, /\.keypad-action-row\s*\{[^}]*grid-template-columns:\s*1.5fr 1fr;/, `${name}: keypad-action-row columns`);
        assert.match(content, /\.dialer-tool-bar\s*\{[^}]*padding:\s*6px 10px;/, `${name}: dialer-tool-bar padding`);
        assert.match(content, /\.dialer-tool-bar\s*\{[^}]*margin-top:\s*4px;/, `${name}: dialer-tool-bar margin-top`);

        // Shutter selectors include console buttons
        assert.match(content, /\.call-pill-btn,\s*\.call-aux-btn,\s*\.end-call-btn,\s*\.hero-pill-action/, `${name}: shutter selector includes console buttons`);
    });
});

test('3. Select Dropdowns, Base Inputs & Dark/Light Theme Support', () => {
    [
        { name: 'views/index.ejs', content: ejsContent },
        { name: 'public/css/softphone.css', content: cssContent }
    ].forEach(({ name, content }) => {
        // Base input-text styling
        assert.match(content, /\.input-text\s*\{[^}]*background:\s*var\(--bg-input\);/, `${name}: input-text background`);
        assert.match(content, /select\.input-text option\s*\{[^}]*background:\s*var\(--bg-input\);/, `${name}: select option background`);

        // Light theme overrides
        assert.match(content, /html\.light-theme \.app-window\s*\{[^}]*background-color:\s*#ffffff;/, `${name}: light theme app-window`);
        assert.match(content, /html\.light-theme \.app-titlebar\s*\{[^}]*background:\s*#f8fafc;/, `${name}: light theme app-titlebar`);
        assert.match(content, /html\.light-theme \.workspace\s*\{[^}]*background:\s*#f8fafc;/, `${name}: light theme workspace`);
        assert.match(content, /html\.light-theme \.workspace-header\s*\{[^}]*background:\s*#ffffff;/, `${name}: light theme workspace-header`);
        assert.match(content, /html\.light-theme \.header-title\s*\{[^}]*color:\s*#0f172a;/, `${name}: light theme header-title`);
        assert.match(content, /html\.light-theme \.header-status-strip select\s*\{[^}]*background:\s*#ffffff\s*!important;/, `${name}: light theme header select`);
        assert.match(content, /html\.light-theme \.sub-nav-tabs\s*\{[^}]*background:\s*#f1f5f9;/, `${name}: light theme sub-nav-tabs`);
        assert.match(content, /html\.light-theme \.sub-nav-tab\.active\s*\{[^}]*background:\s*#b91c1c\s*!important;/, `${name}: light theme active tab`);
        assert.match(content, /html\.light-theme \.dialer-input-box\s*\{[^}]*background:\s*#ffffff;/, `${name}: light theme dialer input box`);
        assert.match(content, /html\.light-theme \.keypad-btn\s*\{[^}]*background:\s*#ffffff\s*!important;/, `${name}: light theme keypad-btn`);
        assert.match(content, /html\.light-theme \.dialer-tool-bar\s*\{[^}]*background:\s*#ffffff;/, `${name}: light theme dialer tool bar`);
        assert.match(content, /html\.light-theme \.active-call-hero\s*\{[^}]*background:\s*#ffffff;/, `${name}: light theme active call hero`);
        assert.match(content, /html\.light-theme \.hero-pill-action\s*\{[^}]*background:\s*#f1f5f9\s*!important;/, `${name}: light theme hero pill action`);
        assert.match(content, /html\.light-theme \.contact-card\s*\{[^}]*background:\s*#ffffff;/, `${name}: light theme contact card`);
    });
});

test('4. Modals, Extensions Roster & Preset JS Management', () => {
    [
        { name: 'views/index.ejs', content: ejsContent },
        { name: 'public/js/softphone-ui.js', content: jsContent }
    ].forEach(({ name, content }) => {
        // Edit and preset modal functions
        assert.match(content, /openPresetModal/, `${name}: openPresetModal exists`);
        assert.match(content, /modalPresetTitle/, `${name}: openPresetModal updates modalPresetTitle`);
        assert.match(content, /savePresetFromModal/, `${name}: savePresetFromModal exists`);
        assert.match(content, /deleteCurrentPreset/, `${name}: deleteCurrentPreset exists`);
        assert.match(content, /setupTransferTabs/, `${name}: setupTransferTabs exists`);
    });
});

test('5. Telephony Console DOM Structure in Rendered HTML', () => {
    assert.match(ejsContent, /id="loginView"/, 'index.ejs contains loginView container');
    assert.match(ejsContent, /id="loginExtSelect"/, 'index.ejs contains loginExtSelect');
    assert.match(ejsContent, /id="loginPasswordInput"/, 'index.ejs contains loginPasswordInput');
    assert.match(ejsContent, /id="loginSubmitBtn"/, 'index.ejs contains loginSubmitBtn');
    assert.match(ejsContent, /id="loginSavedAccountsList"/, 'index.ejs contains loginSavedAccountsList');
    assert.match(ejsContent, /id="mainAppWindow"/, 'index.ejs contains mainAppWindow container');
    assert.match(ejsContent, /class="app-titlebar"/, 'index.ejs contains app-titlebar');
    assert.match(ejsContent, /class="workspace-header"/, 'index.ejs contains workspace-header');
    assert.match(ejsContent, /class="header-status-strip"/, 'index.ejs contains header-status-strip');
    assert.match(ejsContent, /id="presetSelect"/, 'index.ejs contains presetSelect');
    assert.match(ejsContent, /id="connectBtn"/, 'index.ejs contains connectBtn');
    assert.doesNotMatch(ejsContent, /<input[^>]*id="passwordInput"[^>]*class="[^"]*font-mono"[^>]*style="[^"]*85px;?"/, 'telephony console header does not contain passwordInput');
    assert.match(ejsContent, /class="sub-nav-tabs"/, 'index.ejs contains sub-nav-tabs');
    assert.match(ejsContent, /id="tabBtnDialer"/, 'index.ejs contains tabBtnDialer');
    assert.match(ejsContent, /id="tabBtnContacts"/, 'index.ejs contains tabBtnContacts');
    assert.match(ejsContent, /id="tabBtnHistory"/, 'index.ejs contains tabBtnHistory');
    assert.match(ejsContent, /id="tabContentDialer"/, 'index.ejs contains tabContentDialer');
    assert.match(ejsContent, /class="dialer-col"/, 'index.ejs contains dialer-col');
    assert.match(ejsContent, /class="dialer-input-box"/, 'index.ejs contains dialer-input-box');
    assert.match(ejsContent, /class="keypad-grid"/, 'index.ejs contains keypad-grid');
    assert.match(ejsContent, /class="keypad-action-row"/, 'index.ejs contains keypad-action-row');
    assert.match(ejsContent, /class="dialer-tool-bar"/, 'index.ejs contains dialer-tool-bar');
});

test('6. Live HTTP Server Single-Window Direct Render Validation', async () => {
    function fetchUrl(urlPath) {
        return new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:8090${urlPath}`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
            }).on('error', reject);
        });
    }

    // Test English endpoint (default)
    const enRes = await fetchUrl('/');
    assert.equal(enRes.statusCode, 200);
    assert.match(enRes.body, /<html lang="en" dir="ltr">/);
    assert.match(enRes.body, /id="loginView"/);
    assert.match(enRes.body, /id="loginExtSelect"/);
    assert.match(enRes.body, /id="loginPasswordInput"/);
    assert.match(enRes.body, /id="loginSubmitBtn"/);
    assert.match(enRes.body, /id="mainAppWindow"/);
    assert.match(enRes.body, /id="presetSelect"/);
    assert.match(enRes.body, /id="connectBtn"/);

    // Test Arabic endpoint (?lang=ar)
    const arRes = await fetchUrl('/?lang=ar');
    assert.equal(arRes.statusCode, 200);
    assert.match(arRes.body, /<html lang="ar" dir="rtl">/);
    assert.match(arRes.body, /id="loginView"/);
    assert.match(arRes.body, /id="loginExtSelect"/);
    assert.match(arRes.body, /id="loginPasswordInput"/);
    assert.match(arRes.body, /id="loginSubmitBtn"/);
    assert.match(arRes.body, /id="mainAppWindow"/);
    assert.match(arRes.body, /id="presetSelect"/);
    assert.match(arRes.body, /id="connectBtn"/);
});

test('7. WebRTC Extension Login, Password Toggle & Disconnect/Reconnect Parity', () => {
    [
        { name: 'views/index.ejs', content: ejsContent },
        { name: 'public/js/softphone-ui.js', content: jsContent }
    ].forEach(({ name, content }) => {
        // Login methods exist
        assert.match(content, /setLoginInputMode/, `${name}: setLoginInputMode exists`);
        assert.match(content, /toggleLoginPasswordVisibility/, `${name}: toggleLoginPasswordVisibility exists`);
        assert.match(content, /onLoginExtensionSelected/, `${name}: onLoginExtensionSelected exists`);
        assert.match(content, /submitLogin/, `${name}: submitLogin exists`);
        assert.match(content, /quickLoginAccount/, `${name}: quickLoginAccount exists`);
        assert.match(content, /switchAccount/, `${name}: switchAccount exists`);
        assert.match(content, /updateViewMode/, `${name}: updateViewMode exists`);

        // Disconnect and reconnect preserves session credentials without console password prompt
        assert.match(content, /sessionSecrets\.set\(preset\.id,\s*password\)/, `${name}: caches session password on login`);
        assert.match(content, /preset\.secret\s*\|\|\s*this\.sessionSecrets\.get\(preset\.id\)/, `${name}: reconnect retrieves session credentials`);
    });
});
