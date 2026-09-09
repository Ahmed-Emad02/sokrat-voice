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
    res.setHeader('Permissions-Policy', 'microphone=*, autoplay=*');
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

function resolveTelephonyEndpoint(headers = {}, fallbackHost = '127.0.0.1') {
    const forwardedHost = String(headers['x-forwarded-host'] || '').split(',')[0].trim();
    if (forwardedHost) {
        try {
            const parsed = new URL(`https://${forwardedHost}`);
            return {
                host: parsed.hostname,
                defaultWss: `wss://${parsed.host}/ws`
            };
        } catch (_) {}
    }

    const requestHost = String(headers.host || '').trim();
    const host = requestHost.split(':')[0] || fallbackHost;
    const portStr = requestHost.endsWith(':8443') ? ':8443' : '';
    return {
        host,
        defaultWss: `wss://${host}${portStr}/ws`
    };
}


// --- HELPER: FETCH EXTENSIONS FROM ASTERISK / MYSQL ---
async function fetchPbxExtensions() {
    let allExtensions = [];
    let webrtcExtensions = [];

    try {
        const cmdAll = `/usr/bin/mysql -h 127.0.0.1 -u root -padmin -D asterisk -N -e "SELECT u.extension, u.name, COALESCE(d.tech, 'sip') FROM users u LEFT JOIN devices d ON d.id = u.extension ORDER BY CAST(u.extension AS UNSIGNED) ASC;" 2>/dev/null`;
        const { stdout: outAll } = await execAsync(cmdAll, { timeout: 3000 });
        if (outAll && outAll.trim()) {
            allExtensions = outAll.trim().split('\n').filter(Boolean).map(line => {
                const [extension, name, tech] = line.split('\t');
                return { extension, name: name || extension, tech: tech || 'sip' };
            });
        }

        const cmdWeb = `/usr/bin/mysql -h 127.0.0.1 -u root -padmin -D asterisk -N -e "SELECT DISTINCT u.extension, u.name, COALESCE(d.tech, 'pjsip') FROM users u LEFT JOIN devices d ON d.id = u.extension LEFT JOIN sip s_trans ON s_trans.id = u.extension AND s_trans.keyword = 'transport' LEFT JOIN sip s_avpf ON s_avpf.id = u.extension AND s_avpf.keyword = 'avpf' LEFT JOIN sip s_webrtc ON s_webrtc.id = u.extension AND s_webrtc.keyword = 'webrtc' WHERE (d.tech = 'pjsip' OR s_trans.data LIKE '%ws%' OR s_avpf.data = 'yes' OR s_webrtc.data = 'yes') ORDER BY CAST(u.extension AS UNSIGNED) ASC;" 2>/dev/null`;
        const { stdout: outWeb } = await execAsync(cmdWeb, { timeout: 3000 });
        if (outWeb && outWeb.trim()) {
            webrtcExtensions = outWeb.trim().split('\n').filter(Boolean).map(line => {
                const [extension, name, tech] = line.split('\t');
                return { extension, name: name || extension, tech: tech || 'pjsip' };
            });
        }

        if (allExtensions.length > 0) {
            if (webrtcExtensions.length === 0) {
                webrtcExtensions = allExtensions.filter(e => e.tech === 'pjsip');
            }
            return { allExtensions, webrtcExtensions };
        }
    } catch (_) {}

    // Fallback to Asterisk CLI parsing
    return new Promise((resolve) => {
        exec('/usr/sbin/asterisk -rx "pjsip show endpoints" ; /usr/sbin/asterisk -rx "sip show peers"', (err, stdout) => {
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
        const { host, defaultWss } = resolveTelephonyEndpoint(req.headers, req.hostname);
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
    try {
        const safeExt = ext.replace(/[^0-9A-Za-z_-]/g, '');
        const cmd = `/usr/bin/mysql -h 127.0.0.1 -u root -padmin -D asterisk -N -e "SELECT extension, auto_answer, dnd FROM extension_policies WHERE extension = '${safeExt}'" 2>/dev/null`;
        const { stdout } = await execAsync(cmd, { timeout: 3000 });
        if (stdout && stdout.trim()) {
            const [extension, auto_answer, dnd] = stdout.trim().split('\t');
            policy = { extension, auto_answer: auto_answer || 'user_choice', dnd: dnd || 'user_choice' };
        }
    } catch (_) {}
    res.json({ success: true, policy });
});

// --- SOKRAT VOIP SHARED ADDRESS BOOK API (SQLite address_book.db) ---
const SQLITE_DB_PATH = '/var/www/db/address_book.db';

function escapeSql(str) {
    return String(str || '').replace(/'/g, "''").trim();
}

async function runSqliteCmd(sql) {
    const cmd = `/usr/bin/sqlite3 "${SQLITE_DB_PATH}" "${sql.replace(/"/g, '\\"')}"`;
    return await execAsync(cmd, { timeout: 4000 });
}

async function runSqliteQuery(sql) {
    const cmd = `/usr/bin/sqlite3 -separator '~~~' "${SQLITE_DB_PATH}" "${sql.replace(/"/g, '\\"')}"`;
    const { stdout } = await execAsync(cmd, { timeout: 4000 });
    return stdout || '';
}

// 1. GET Contacts
app.get(['/api/contacts', '/phone/api/contacts'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        const stdout = await runSqliteQuery("SELECT id, name, last_name, telefono FROM contact ORDER BY name ASC, last_name ASC;");
        const lines = stdout.split('\n').filter(Boolean);
        const contacts = lines.map(line => {
            const parts = line.split('~~~');
            const id = parts[0] || '';
            const firstName = parts[1] || '';
            const lastName = parts[2] || '';
            const phone = parts[3] || '';
            const fullName = (lastName ? `${firstName} ${lastName}` : firstName).trim();
            return {
                id: `contact_${id}`,
                dbId: parseInt(id, 10),
                name: fullName || phone,
                firstName,
                lastName,
                number: phone,
                isFavorite: false
            };
        });

        // Also fetch PBX extensions to include directory extensions
        const { allExtensions } = await fetchPbxExtensions();
        const seenNumbers = new Set(contacts.map(c => c.number));
        allExtensions.forEach(ext => {
            const numStr = String(ext.extension);
            if (!seenNumbers.has(numStr)) {
                contacts.push({
                    id: `ext_${numStr}`,
                    name: ext.name && ext.name !== ext.extension ? ext.name : `Ext ${numStr}`,
                    firstName: ext.name || `Ext ${numStr}`,
                    lastName: '',
                    number: numStr,
                    isFavorite: false,
                    isExtension: true
                });
            }
        });

        res.json({ success: true, contacts });
    } catch (err) {
        console.error('[Contacts API] Error fetching contacts:', err.message);
        res.json({ success: false, error: err.message, contacts: [] });
    }
});

// 2. ADD Contact
app.post(['/api/contacts/add', '/phone/api/contacts/add', '/api/contacts', '/phone/api/contacts'], async (req, res) => {
    try {
        let { firstName, lastName, name, phone, number } = req.body || {};
        const rawName = String(name || firstName || '').trim();
        const rawPhone = String(phone || number || '').trim();

        if (!rawName || !rawPhone) {
            return res.status(400).json({ success: false, error: 'Name and phone number are required' });
        }

        let fName = firstName ? String(firstName).trim() : '';
        let lName = lastName ? String(lastName).trim() : '';
        if (!fName && rawName) {
            const spaceIdx = rawName.indexOf(' ');
            if (spaceIdx > 0) {
                fName = rawName.substring(0, spaceIdx).trim();
                lName = rawName.substring(spaceIdx + 1).trim();
            } else {
                fName = rawName;
            }
        }

        const cleanedPhone = rawPhone.replace(/[\s\-\(\)\.]/g, '');
        let finalPhone = cleanedPhone;
        if (/^\d+$/.test(cleanedPhone) && !cleanedPhone.startsWith('0') && cleanedPhone.length >= 7 && cleanedPhone.length <= 11) {
            finalPhone = '0' + cleanedPhone;
        }

        const fEsc = escapeSql(fName);
        const lEsc = escapeSql(lName);
        const pEsc = escapeSql(finalPhone);

        const sql = `INSERT INTO contact (name, last_name, telefono, iduser, status, directory) VALUES ('${fEsc}', '${lEsc}', '${pEsc}', 1, 'isPublic', 'external');`;
        await runSqliteCmd(sql);

        const lastIdOut = await runSqliteQuery("SELECT last_insert_rowid();");
        const dbId = parseInt(lastIdOut.trim(), 10) || Date.now();

        const fullName = (lName ? `${fName} ${lName}` : fName).trim();
        res.json({
            success: true,
            message: 'Contact added to Sokrat VoIP address book successfully.',
            contact: {
                id: `contact_${dbId}`,
                dbId,
                name: fullName,
                firstName: fName,
                lastName: lName,
                number: finalPhone,
                isFavorite: false
            }
        });
    } catch (err) {
        console.error('[Contacts API] Error adding contact:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. EDIT Contact
app.post(['/api/contacts/edit', '/phone/api/contacts/edit'], async (req, res) => {
    try {
        let { id, dbId, firstName, lastName, name, phone, number } = req.body || {};
        let targetId = dbId;
        if (!targetId && id) {
            const parsed = String(id).replace(/^contact_/, '');
            if (/^\d+$/.test(parsed)) targetId = parseInt(parsed, 10);
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: 'Valid contact ID is required' });
        }

        const rawName = String(name || firstName || '').trim();
        const rawPhone = String(phone || number || '').trim();

        if (!rawName || !rawPhone) {
            return res.status(400).json({ success: false, error: 'Name and phone number are required' });
        }

        let fName = firstName ? String(firstName).trim() : '';
        let lName = lastName ? String(lastName).trim() : '';
        if (!fName && rawName) {
            const spaceIdx = rawName.indexOf(' ');
            if (spaceIdx > 0) {
                fName = rawName.substring(0, spaceIdx).trim();
                lName = rawName.substring(spaceIdx + 1).trim();
            } else {
                fName = rawName;
            }
        }

        const cleanedPhone = rawPhone.replace(/[\s\-\(\)\.]/g, '');
        let finalPhone = cleanedPhone;
        if (/^\d+$/.test(cleanedPhone) && !cleanedPhone.startsWith('0') && cleanedPhone.length >= 7 && cleanedPhone.length <= 11) {
            finalPhone = '0' + cleanedPhone;
        }

        const fEsc = escapeSql(fName);
        const lEsc = escapeSql(lName);
        const pEsc = escapeSql(finalPhone);

        const sql = `UPDATE contact SET name = '${fEsc}', last_name = '${lEsc}', telefono = '${pEsc}' WHERE id = ${targetId};`;
        await runSqliteCmd(sql);

        const fullName = (lName ? `${fName} ${lName}` : fName).trim();
        res.json({
            success: true,
            message: 'Contact updated in Sokrat VoIP address book successfully.',
            contact: {
                id: `contact_${targetId}`,
                dbId: targetId,
                name: fullName,
                firstName: fName,
                lastName: lName,
                number: finalPhone,
                isFavorite: false
            }
        });
    } catch (err) {
        console.error('[Contacts API] Error updating contact:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. DELETE Contact
app.post(['/api/contacts/delete', '/phone/api/contacts/delete'], async (req, res) => {
    try {
        let { id, dbId } = req.body || {};
        let targetId = dbId;
        if (!targetId && id) {
            const parsed = String(id).replace(/^contact_/, '');
            if (/^\d+$/.test(parsed)) targetId = parseInt(parsed, 10);
        }

        if (targetId) {
            const sql = `DELETE FROM contact WHERE id = ${targetId};`;
            await runSqliteCmd(sql);
        }

        res.json({ success: true, message: 'Contact deleted from Sokrat VoIP address book successfully.' });
    } catch (err) {
        console.error('[Contacts API] Error deleting contact:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
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

// Trunk Call State — query Asterisk channels and GSM dongle state directly
app.get(['/api/trunk-call-state', '/phone/api/trunk-call-state'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const ext = req.query.ext || '';
        const { stdout: chans } = await execAsync(
            '/usr/sbin/asterisk -rx "core show channels concise" 2>/dev/null',
            { timeout: 3000 }
        );
        const channelLines = (chans || '').split('\n').filter(Boolean);

        let callerActive = false;
        if (ext) {
            callerActive = channelLines.some(l => l.startsWith(`PJSIP/${ext}-`));
        } else {
            callerActive = channelLines.some(l => l.startsWith('PJSIP/'));
        }

        let trunkActive = channelLines.some(l => l.toLowerCase().startsWith('dongle/'));

        if (!trunkActive) {
            try {
                const { stdout: dongleState } = await execAsync(
                    '/usr/sbin/asterisk -rx "dongle show device state dongle0" 2>/dev/null',
                    { timeout: 3000 }
                );
                const activeMatch = dongleState.match(/Active\s*:\s*([1-9]\d*)/);
                const dialingMatch = dongleState.match(/Dialing\s*:\s*([1-9]\d*)/);
                const alertingMatch = dongleState.match(/Alerting\s*:\s*([1-9]\d*)/);
                if (activeMatch || dialingMatch || alertingMatch) {
                    trunkActive = true;
                }
            } catch (_) {}
        }

        const result = { success: true, callerActive, trunkActive };
        res.json(result);
    } catch (err) {
        console.error('[trunk-call-state] error:', err.message);
        res.json({ success: false, callerActive: true, trunkActive: true, error: err.message });
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

module.exports = { app, server, resolveTelephonyEndpoint };
