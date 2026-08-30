const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let mysql = null;
try {
    mysql = require('mysql2/promise');
} catch (_) {}

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 8090;
const HOST = process.env.HOST || '127.0.0.1';

// --- SECURITY HEADERS MIDDLEWARE ---
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' blob: data:; connect-src 'self' wss: ws: https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none';"
    );
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), speaker-selection=(self)');
    next();
});

// Parse JSON & URL-encoded request bodies
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Static Assets (Available at both / and /phone/)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));
app.use('/phone', express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));

// EJS View Engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// --- HELPER: FETCH EXTENSIONS FROM ASTERISK / MYSQL ---
async function fetchPbxExtensions() {
    let allExtensions = [];
    let webrtcExtensions = [];

    if (mysql) {
        try {
            const conn = await mysql.createConnection({
                host: process.env.DB_HOST || '127.0.0.1',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASS || 'admin',
                database: process.env.ASTERISK_DB || 'asterisk'
            });

            // 1. Fetch All PBX Extensions (for Transfer and Contacts Directory)
            const [allRows] = await conn.execute(`
                SELECT u.extension, u.name, COALESCE(d.tech, 'sip') AS tech
                FROM users u
                LEFT JOIN devices d ON d.id = u.extension
                ORDER BY CAST(u.extension AS UNSIGNED) ASC
            `);
            allExtensions = allRows.map(r => ({
                extension: String(r.extension),
                name: r.name || String(r.extension),
                tech: r.tech || 'sip'
            }));

            // 2. Fetch WebRTC-Capable Extensions (for Registration)
            const [webrtcRows] = await conn.execute(`
                SELECT DISTINCT u.extension, u.name, COALESCE(d.tech, 'pjsip') AS tech
                FROM users u
                LEFT JOIN devices d ON d.id = u.extension
                LEFT JOIN sip s_trans ON s_trans.id = u.extension AND s_trans.keyword = 'transport'
                LEFT JOIN sip s_avpf ON s_avpf.id = u.extension AND s_avpf.keyword = 'avpf'
                LEFT JOIN sip s_webrtc ON s_webrtc.id = u.extension AND s_webrtc.keyword = 'webrtc'
                WHERE (
                    d.tech = 'pjsip' 
                    OR s_trans.data LIKE '%ws%' 
                    OR s_avpf.data = 'yes' 
                    OR s_webrtc.data = 'yes'
                )
                ORDER BY CAST(u.extension AS UNSIGNED) ASC
            `);
            webrtcExtensions = webrtcRows.map(r => ({
                extension: String(r.extension),
                name: r.name || String(r.extension),
                tech: r.tech || 'pjsip'
            }));

            await conn.end();
            return { allExtensions, webrtcExtensions };
        } catch (_) {}
    }

    // Fallback to Asterisk CLI parsing
    return new Promise((resolve) => {
        exec('/usr/sbin/asterisk -rx "pjsip show endpoints" -rx "sip show peers"', (err, stdout) => {
            const list = [];
            const webrtcList = [];
            const seen = new Set();
            if (stdout) {
                const pjsipMatches = stdout.matchAll(/Endpoint:\s+([0-9A-Za-z_-]+)\/[^\n]+/g);
                for (const m of pjsipMatches) {
                    const ext = m[1];
                    if (!seen.has(ext) && ext !== 'dummy_endpoint') {
                        seen.add(ext);
                        webrtcList.push({ extension: ext, name: ext, tech: 'pjsip' });
                        list.push({ extension: ext, name: ext, tech: 'pjsip' });
                    }
                }
                const sipMatches = stdout.matchAll(/^([0-9A-Za-z_-]+)(?:\/[0-9A-Za-z_-]+)?\s+[0-9.]+/gm);
                for (const m of sipMatches) {
                    const ext = m[1];
                    if (!seen.has(ext)) {
                        seen.add(ext);
                        list.push({ extension: ext, name: ext, tech: 'sip' });
                    }
                }
            }
            if (webrtcList.length === 0) webrtcList.push({ extension: '150', name: '150', tech: 'pjsip' });
            if (list.length === 0) {
                list.push({ extension: '101', name: '101', tech: 'sip' });
                list.push({ extension: '150', name: '150', tech: 'pjsip' });
            }
            resolve({ allExtensions: list, webrtcExtensions: webrtcList });
        });
    });
}

// Health Check Endpoint
app.get(['/health', '/phone/health'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({
        status: 'ok',
        service: 'sokrat-softphone',
        version: '2.0.0',
        uptimeSec: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

app.get(['/api/extensions', '/phone/api/extensions'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        const { allExtensions, webrtcExtensions } = await fetchPbxExtensions();
        const host = req.headers['x-forwarded-host'] || req.headers['host']?.split(':')[0] || req.hostname || '127.0.0.1';
        const portStr = (req.headers.host && req.headers.host.includes(':8443')) ? ':8443' : '';
        const defaultWss = `wss://${host}${portStr}/ws`;
        res.json({
            success: true,
            extensions: allExtensions,
            webrtcExtensions: webrtcExtensions,
            host,
            defaultWss
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, extensions: [], webrtcExtensions: [] });
    }
});

// Recording Status — polls Asterisk CLI to check if MixMonitor is active on ext 150 channel
app.get(['/api/recording-status', '/phone/api/recording-status'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        const { stdout } = await execAsync(
            '/usr/sbin/asterisk -rx "core show channels concise" 2>/dev/null',
            { timeout: 5000 }
        );
        // Find active PJSIP/150 channels
        const lines = (stdout || '').split('\n').filter(l => l.startsWith('PJSIP/150-'));
        if (lines.length === 0) {
            return res.json({ recording: false, channel: null });
        }
        // Check each active 150 channel for MixMonitor audiohook
        const channelName = lines[0].split('!')[0];
        const { stdout: chanDetail } = await execAsync(
            `/usr/sbin/asterisk -rx "core show channel ${channelName}" 2>/dev/null`,
            { timeout: 5000 }
        );
        const isRecording = /MixMonitor/i.test(chanDetail || '');
        res.json({ recording: isRecording, channel: channelName });
    } catch (_) {
        res.json({ recording: false, channel: null });
    }
});

// Call Status — check recording and channel state for a given call ID
app.get(['/api/call-status/:callId', '/phone/api/call-status/:callId'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const callId = req.params.callId;
    if (!callId || !/^[A-Za-z0-9._/-]+$/.test(callId)) {
        return res.status(400).json({ success: false, error: 'Invalid callId' });
    }
    try {
        const { stdout } = await execAsync(
            '/usr/sbin/asterisk -rx "core show channels concise" 2>/dev/null',
            { timeout: 5000 }
        );
        // Match channel by callId (uniqueid field in concise output)
        const lines = (stdout || '').split('\n').filter(l => l.includes(callId));
        if (lines.length === 0) {
            return res.json({ success: true, active: false, recording: false });
        }
        const channelName = lines[0].split('!')[0];
        const { stdout: chanDetail } = await execAsync(
            `/usr/sbin/asterisk -rx "core show channel ${channelName}" 2>/dev/null`,
            { timeout: 5000 }
        );
        const isRecording = /MixMonitor/i.test(chanDetail || '');
        res.json({ success: true, active: true, recording: isRecording, channel: channelName });
    } catch (_) {
        res.json({ success: true, active: false, recording: false });
    }
});

// --- EXTENSION POLICY API ---
app.get(['/api/extension-policy/:ext', '/phone/api/extension-policy/:ext'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ext = String(req.params.ext || '').trim();
    if (!ext) return res.json({ success: true, policy: { extension: '', auto_answer: 'user_choice', dnd: 'user_choice' } });

    let policy = { extension: ext, auto_answer: 'user_choice', dnd: 'user_choice' };
    if (mysql) {
        try {
            const conn = await mysql.createConnection({
                host: process.env.DB_HOST || '127.0.0.1',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASS || 'admin',
                database: process.env.ASTERISK_DB || 'asterisk'
            });
            const [rows] = await conn.execute(
                'SELECT extension, auto_answer, dnd FROM extension_policies WHERE extension = ?',
                [ext]
            );
            await conn.end();
            if (rows && rows.length > 0) {
                policy = rows[0];
            }
        } catch (_) {}
    }
    res.json({ success: true, policy });
});

// Main Standalone Softphone Interface with Server-Side Pre-rendered Extensions
app.get(['/', '/phone'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const currentLang = (req.query.lang === 'ar') ? 'ar' : 'en';
    let extensions = [];
    let host = req.headers['x-forwarded-host'] || req.headers['host']?.split(':')[0] || req.hostname || '127.0.0.1';
    try {
        const pbxData = await fetchPbxExtensions();
        extensions = (pbxData.webrtcExtensions && pbxData.webrtcExtensions.length > 0) ? pbxData.webrtcExtensions : pbxData.allExtensions;
    } catch (_) {
        extensions = [{ extension: '150', name: '150', tech: 'pjsip' }];
    }
    if (!extensions || extensions.length === 0) {
        extensions = [{ extension: '150', name: '150', tech: 'pjsip' }];
    }
    res.render('index', {
        currentLang,
        isRtl: currentLang === 'ar',
        extensions,
        host,
        version: '2.0.0'
    });
});

// Trunk Call State — query GSM modem directly via AT+CLCC.
// chan_dongle's device state and Asterisk channels stay alive after callee
// decline, but the modem itself reports no active calls via AT+CLCC.
const LOG_FILE = '/var/log/asterisk/messages';

async function isDongleCallActive(dongle) {
    try {
        const fs = require('fs');
        const bytesBefore = fs.statSync(LOG_FILE).size;
        await execAsync(
            `/usr/sbin/asterisk -rx "dongle cmd ${dongle} AT+CLCC" 2>/dev/null`,
            { timeout: 3000 }
        );
        // Wait for modem to respond and Asterisk to log it
        await new Promise(r => setTimeout(r, 800));
        const bytesAfter = fs.statSync(LOG_FILE).size;
        if (bytesAfter <= bytesBefore) return false;
        const fd = fs.openSync(LOG_FILE, 'r');
        const buf = Buffer.alloc(bytesAfter - bytesBefore);
        fs.readSync(fd, buf, 0, buf.length, bytesBefore);
        fs.closeSync(fd);
        return buf.toString().includes('+CLCC:');
    } catch (_) {
        return false;
    }
}

app.get(['/api/trunk-call-state', '/phone/api/trunk-call-state'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        // Query the GSM modem directly via AT+CLCC (List Current Calls).
        // This bypasses chan_dongle's broken state machine.
        const fs = require('fs');
        const bytesBefore = fs.statSync(LOG_FILE).size;
        await execAsync(
            '/usr/sbin/asterisk -rx "dongle cmd dongle0 AT+CLCC" 2>/dev/null',
            { timeout: 3000 }
        );
        await new Promise(r => setTimeout(r, 600));
        const bytesAfter = fs.statSync(LOG_FILE).size;
        let trunkActive = false;
        if (bytesAfter > bytesBefore) {
            const fd = fs.openSync(LOG_FILE, 'r');
            const buf = Buffer.alloc(Math.min(bytesAfter - bytesBefore, 4096));
            fs.readSync(fd, buf, 0, buf.length, bytesBefore);
            fs.closeSync(fd);
            trunkActive = buf.toString().includes('+CLCC:');
        }
        // Check PJSIP/150 channel
        const { stdout: chans } = await execAsync(
            '/usr/sbin/asterisk -rx "core show channels concise" 2>/dev/null',
            { timeout: 3000 }
        );
        const callerActive = (chans || '').split('\n').some(l => l.startsWith('PJSIP/150-'));
        const result = { callerActive, trunkActive };
        console.log('[trunk-call-state]', JSON.stringify(result));
        res.json(result);
    } catch (err) {
        console.error('[trunk-call-state] error:', err.message);
        res.json({ callerActive: false, trunkActive: false });
    }
});
// 404 Handler
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not Found' });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('[Sokrat Softphone Error]:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// --- SERVER START & LIFECYCLE ---
let server = null;
if (require.main === module) {
    server = app.listen(PORT, HOST, () => {
        console.log(`[Sokrat Softphone] Standalone Daemon active on http://${HOST}:${PORT}`);
    });
}

// Graceful Shutdown
function handleShutdown(signal) {
    console.log(`[Sokrat Softphone] Received ${signal}, shutting down gracefully...`);
    if (server) {
        server.close(() => {
            console.log('[Sokrat Softphone] HTTP server closed.');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
    setTimeout(() => {
        console.error('[Sokrat Softphone] Forced shutdown due to timeout.');
        process.exit(1);
    }, 5000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = { app, server };
