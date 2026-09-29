const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let mysql = null;
try {
    mysql = require('mysql2/promise');
} catch (_) {
    try {
        mysql = require('/opt/sokrat-voip/node_modules/mysql2/promise');
    } catch (_) {}
}

let dbPool = null;
if (mysql) {
    try {
        dbPool = mysql.createPool({
            host: '127.0.0.1',
            user: 'root',
            password: 'admin',
            database: 'asterisk',
            waitForConnections: true,
            connectionLimit: 5
        });
    } catch (_) {}
}

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
    const isPort8443 = requestHost.endsWith(':8443') || String(headers['x-forwarded-port'] || '') === '8443';
    const portStr = isPort8443 ? ':8443' : '';
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
    if (!ext) return res.json({ success: true, policy: { extension: '', auto_answer: 'user_choice', dnd: 'user_choice', disable_outbound_ringing_cancel: 0 } });

    let policy = { extension: ext, auto_answer: 'user_choice', dnd: 'user_choice', disable_outbound_ringing_cancel: 0 };
    try {
        if (dbPool) {
            try {
                const [rows] = await dbPool.query('SELECT extension, auto_answer, dnd, COALESCE(disable_outbound_ringing_cancel, 0) AS disable_outbound_ringing_cancel FROM extension_policies WHERE extension = ?', [ext]);
                if (rows && rows.length > 0) {
                    policy = {
                        extension: rows[0].extension,
                        auto_answer: rows[0].auto_answer || 'user_choice',
                        dnd: rows[0].dnd || 'user_choice',
                        disable_outbound_ringing_cancel: rows[0].disable_outbound_ringing_cancel ? 1 : 0
                    };
                    return res.json({ success: true, policy });
                }
            } catch (_) {}
        }
        const safeExt = ext.replace(/[^0-9A-Za-z_-]/g, '');
        const cmd = `/usr/bin/mysql -h 127.0.0.1 -u root -padmin -D asterisk -N -e "SELECT extension, auto_answer, dnd, COALESCE(disable_outbound_ringing_cancel, 0) FROM extension_policies WHERE extension = '${safeExt}'" 2>/dev/null`;
        const { stdout } = await execAsync(cmd, { timeout: 3000 });
        if (stdout && stdout.trim()) {
            const [extension, auto_answer, dnd, disable_cancel] = stdout.trim().split('\t');
            policy = {
                extension,
                auto_answer: auto_answer || 'user_choice',
                dnd: dnd || 'user_choice',
                disable_outbound_ringing_cancel: parseInt(disable_cancel, 10) === 1 ? 1 : 0
            };
        }
    } catch (_) {}
    res.json({ success: true, policy });
});
// Active campaign lead assigned to a registered softphone extension.
// Keep this endpoint read-only and uncached: it is polled by the standalone voice UI.
app.get(['/api/dialer/active-lead', '/phone/api/dialer/active-lead'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const requestedExtension = String(req.query.extension || req.query.ext || '').trim();
    if (!requestedExtension || !/^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$/.test(requestedExtension)) {
        return res.status(400).json({ success: false, error: 'Invalid extension', lead: null });
    }

    try {
        let row = null;
        if (dbPool) {
            try {
                const [rows] = await dbPool.query(`
                    SELECT
                        a.attempt_uuid,
                        a.campaign_id,
                        l.id AS lead_id,
                        c.name AS campaign_name,
                        c.lead_fields,
                        l.phone_number,
                        l.first_name,
                        l.last_name,
                        l.company,
                        l.custom_data
                    FROM dialer_call_attempts a
                    INNER JOIN dialer_leads l ON l.id = a.lead_id
                    INNER JOIN dialer_campaigns c ON c.id = a.campaign_id
                    WHERE a.agent_extension = ?
                      AND (a.active_flag = 1 OR a.updated_at >= NOW() - INTERVAL 1 MINUTE)
                    ORDER BY (a.active_flag = 1) DESC, a.updated_at DESC
                    LIMIT 1
                `, [requestedExtension]);
                row = rows[0] || null;
            } catch (dbErr) {
                console.warn('[dialer-active-lead] db pool query warning:', dbErr.message);
            }
        }

        if (!row) {
            const sql = `
                SELECT
                    a.attempt_uuid,
                    a.campaign_id,
                    l.id AS lead_id,
                    c.name AS campaign_name,
                    TO_BASE64(COALESCE(c.lead_fields, '')) AS lead_fields_b64,
                    l.phone_number,
                    l.first_name,
                    l.last_name,
                    COALESCE(l.company, '') AS company,
                    TO_BASE64(COALESCE(l.custom_data, '')) AS custom_data_b64
                FROM dialer_call_attempts a
                INNER JOIN dialer_leads l ON l.id = a.lead_id
                INNER JOIN dialer_campaigns c ON c.id = a.campaign_id
                WHERE a.agent_extension = '${requestedExtension}'
                  AND (a.active_flag = 1 OR a.updated_at >= NOW() - INTERVAL 1 MINUTE)
                ORDER BY (a.active_flag = 1) DESC, a.updated_at DESC
                LIMIT 1
            `.replace(/\\s+/g, ' ').trim();
            const cmd = `/usr/bin/mysql -h 127.0.0.1 -u root -padmin -D asterisk -N -B -e "${sql.replace(/"/g, '\\\\"')}" 2>/dev/null`;
            const { stdout } = await execAsync(cmd, { timeout: 3000 });
            const line = (stdout || '').trim().split('\\n')[0];
            if (line) {
                const parts = line.split('\\t');
                if (parts.length >= 10) {
                    let lf = '';
                    let cd = '';
                    try { lf = Buffer.from(parts[4], 'base64').toString('utf8'); } catch (_) {}
                    try { cd = Buffer.from(parts[9], 'base64').toString('utf8'); } catch (_) {}
                    row = {
                        attempt_uuid: parts[0],
                        campaign_id: parts[1],
                        lead_id: parts[2],
                        campaign_name: parts[3],
                        lead_fields: lf,
                        phone_number: parts[5],
                        first_name: parts[6],
                        last_name: parts[7],
                        company: parts[8],
                        custom_data: cd
                    };
                }
            }
        }

        if (!row) return res.json({ success: true, lead: null });

        let customData = {};
        try {
            const parsed = typeof row.custom_data === 'string' ? JSON.parse(row.custom_data) : row.custom_data;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) customData = parsed;
        } catch (_) {}

        let leadFields = [];
        try {
            const parsed = typeof row.lead_fields === 'string' ? JSON.parse(row.lead_fields) : row.lead_fields;
            if (Array.isArray(parsed)) {
                leadFields = parsed.slice(0, 40).map(field => ({
                    key: String(field?.key || '').trim().slice(0, 64),
                    label: String(field?.label || '').trim().slice(0, 120)
                })).filter(field => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field.key) && field.label);
            }
        } catch (_) {}

        return res.json({
            success: true,
            lead: {
                attempt_uuid: row.attempt_uuid || null,
                campaign_id: row.campaign_id == null ? null : Number(row.campaign_id),
                lead_id: row.lead_id == null ? null : Number(row.lead_id),
                campaign_name: row.campaign_name || '',
                phone_number: row.phone_number || '',
                first_name: row.first_name || '',
                last_name: row.last_name || '',
                company: row.company || '',
                custom_data: customData,
                lead_fields: leadFields
            }
        });
    } catch (err) {
        console.error('[dialer-active-lead] error:', err.message);
        return res.status(500).json({ success: false, error: 'Unable to load active lead', lead: null });
    }
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

// =========================================================================
// --- CRM TELEPHONY INTEGRATION REST API (Every Action in Every State) ---
// =========================================================================

const net = require('net');
const AMI_HOST = process.env.AMI_HOST || '127.0.0.1';
const AMI_PORT = parseInt(process.env.AMI_PORT, 10) || 5038;
const AMI_USER = process.env.AMI_USER || 'admin';
const AMI_PASS = process.env.AMI_PASS || 'admin';

function parseAmiResponse(raw) {
    const lines = (raw || '').split(/\r?\n/);
    const result = { success: false, raw };
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) {
            const key = line.slice(0, idx).trim().toLowerCase();
            const val = line.slice(idx + 1).trim();
            result[key] = val;
            if (key === 'response') {
                result.success = val.toLowerCase() === 'success';
            }
        }
    }
    return result;
}

function execAmiAction(actionObj, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        let client = null;
        let timer = null;
        let buffer = '';
        let authed = false;

        timer = setTimeout(() => {
            if (client) client.destroy();
            reject(new Error(`AMI action ${actionObj.Action || 'unknown'} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        client = net.createConnection({ port: AMI_PORT, host: AMI_HOST }, () => {
            // Socket connected, Asterisk banner will arrive
        });

        client.on('data', (chunk) => {
            buffer += chunk.toString();
            if (!authed && buffer.includes('Asterisk Call Manager')) {
                buffer = '';
                client.write(`Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_PASS}\r\n\r\n`);
                authed = true;
            } else if (authed) {
                if (buffer.includes('Message: Authentication accepted')) {
                    buffer = '';
                    let req = '';
                    for (const [k, v] of Object.entries(actionObj)) {
                        req += `${k}: ${v}\r\n`;
                    }
                    req += '\r\n';
                    client.write(req);
                } else if (buffer.includes('--END COMMAND--') || (buffer.includes('Response: ') && buffer.includes('\r\n\r\n'))) {
                    clearTimeout(timer);
                    const resStr = buffer;
                    try {
                        client.write('Action: Logoff\r\n\r\n');
                        client.end();
                    } catch (_) {}
                    resolve(parseAmiResponse(resStr));
                }
            }
        });

        client.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function execAsteriskCmd(cmd) {
    try {
        const amiRes = await execAmiAction({ Action: 'Command', Command: cmd }, 3000);
        if (amiRes && amiRes.raw) {
            const lines = amiRes.raw.split(/\r?\n/)
                .filter(l => l.startsWith('Output: '))
                .map(l => l.slice(8));
            if (lines.length > 0) return lines.join('\n');
        }
    } catch (_) {}
    const { stdout } = await execAsync(`/usr/sbin/asterisk -rx "${cmd.replace(/"/g, '\\"')}" 2>/dev/null`, { timeout: 3000 }).catch(() => ({ stdout: '' }));
    return stdout || '';
}

async function getExtensionCallStatus(extension, preferredChannel = null) {
    const extStr = String(extension || '').trim();
    const prefChan = String(preferredChannel || '').trim();

    const stdout = await execAsteriskCmd('core show channels concise');

    const lines = (stdout || '').split('\n').filter(Boolean);
    const matched = [];

    for (const line of lines) {
        const p = line.split('!');
        if (p.length < 13) continue;

        const channel = p[0];
        const context = p[1];
        const exten = p[2];
        const priority = p[3];
        const stateCode = p[4];
        const app = p[5];
        const appData = p[6];
        const callerId = p[7];
        const duration = parseInt(p[10], 10) || 0;
        const bridgedChannel = p[11] || '';
        const uniqueId = p[12];

        if (prefChan && (channel === prefChan || channel.startsWith(`${prefChan}-`))) {
            matched.unshift({
                channel, context, exten, priority, stateCode, app, appData,
                callerId, duration, bridgedChannel, uniqueId
            });
            continue;
        }

        const matchesExt = extStr && (
            channel.startsWith(`PJSIP/${extStr}-`) ||
            channel.startsWith(`SIP/${extStr}-`) ||
            channel.startsWith(`Local/${extStr}@`) ||
            callerId === extStr ||
            exten === extStr ||
            (appData && (appData.includes(`/${extStr}`) || appData.includes(`PJSIP/${extStr}`) || appData.includes(`SIP/${extStr}`)))
        );

        if (matchesExt) {
            matched.push({
                channel, context, exten, priority, stateCode, app, appData,
                callerId, duration, bridgedChannel, uniqueId
            });
        }
    }

    if (matched.length === 0) {
        return {
            extension: extStr,
            state: 'IDLE',
            active: false,
            channel: null,
            bridgedChannel: null,
            callId: null,
            duration: 0,
            direction: null,
            callerNumber: null,
            destination: null,
            channels: []
        };
    }

    const primary = matched[0];
    const isUp = matched.some(m => m.stateCode === '6' || m.stateCode === 'Up');
    const isRinging = matched.some(m => m.stateCode === '4' || m.stateCode === '5' || m.stateCode === 'Ring' || m.stateCode === 'Ringing');
    const isDialing = matched.some(m => m.stateCode === '3' || m.stateCode === 'Dialing');

    let state = 'IDLE';
    let direction = 'inbound';

    if (isUp) {
        state = 'IN_CALL';
        direction = (primary.callerId === extStr || primary.channel.startsWith(`PJSIP/${extStr}`) || primary.channel.startsWith(`SIP/${extStr}`)) ? 'outbound' : 'inbound';
    } else if (isRinging) {
        if (primary.callerId === extStr || primary.channel.startsWith(`PJSIP/${extStr}`) || primary.channel.startsWith(`SIP/${extStr}`)) {
            state = 'RINGING_OUTGOING';
            direction = 'outbound';
        } else {
            state = 'RINGING_INCOMING';
            direction = 'inbound';
        }
    } else if (isDialing) {
        state = 'RINGING_OUTGOING';
        direction = 'outbound';
    } else {
        state = 'IN_CALL';
    }

    let isRecording = false;
    try {
        const { stdout: chanDetail } = await execAsync(
            `/usr/sbin/asterisk -rx "core show channel ${primary.channel}" 2>/dev/null`,
            { timeout: 3000 }
        );
        isRecording = /MixMonitor/i.test(chanDetail || '');
    } catch (_) {}

    return {
        extension: extStr,
        state,
        active: true,
        channel: primary.channel,
        bridgedChannel: primary.bridgedChannel || null,
        callId: primary.uniqueId,
        duration: primary.duration,
        direction,
        callerNumber: primary.callerId || null,
        destination: primary.exten || null,
        recording: isRecording,
        channels: matched
    };
}

// 1. STATE QUERY: Query real-time call & channel state for an extension (all states)
app.get(['/api/call/state', '/phone/api/call/state', '/api/call/status', '/phone/api/call/status'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const ext = String(req.query.ext || req.query.extension || '').trim();
    const chan = String(req.query.channel || '').trim();

    if (!ext && !chan) {
        return res.status(400).json({ success: false, error: 'Query parameter "ext" or "channel" is required' });
    }

    try {
        const details = await getExtensionCallStatus(ext, chan);
        res.json({
            success: true,
            ...details
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. IDLE STATE ACTION: Originate / Dial an outbound call
app.post(['/api/call/originate', '/phone/api/call/originate', '/api/call/dial', '/phone/api/call/dial'], async (req, res) => {
    try {
        const { extension, destination, number, phone, target, callerId, timeout, autoAnswer } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const dest = String(destination || number || phone || target || '').trim().replace(/[^\d+*#]/g, '');

        if (!ext) return res.status(400).json({ success: false, error: 'Extension is required' });
        if (!dest) return res.status(400).json({ success: false, error: 'Destination number is required' });

        let tech = 'PJSIP';
        try {
            const { stdout } = await execAsync(`/usr/sbin/asterisk -rx "pjsip show endpoint ${ext}" 2>/dev/null`);
            if (stdout && !stdout.includes('Unable to find') && !stdout.includes('not found')) {
                tech = 'PJSIP';
            } else {
                tech = 'SIP';
            }
        } catch (_) {}

        const cid = callerId || ext;
        const autoAnswerHdr = (autoAnswer !== false) ? 'P-Auto-Answer=normal,Alert-Info=ring-answer' : '';

        const amiAction = {
            Action: 'Originate',
            Channel: `Local/${ext}@from-internal`,
            Context: 'from-internal',
            Exten: dest,
            Priority: '1',
            CallerID: `${cid} <${cid}>`,
            Timeout: String(parseInt(timeout, 10) || 30000),
            Async: 'true'
        };

        if (autoAnswerHdr) {
            amiAction.Variable = `__SIPADDHEADER=${autoAnswerHdr}`;
        }

        try {
            const amiRes = await execAmiAction(amiAction);
            return res.json({
                success: true,
                message: 'Call origination dispatched successfully',
                extension: ext,
                destination: dest,
                technology: tech,
                ami: amiRes
            });
        } catch (amiErr) {
            const cliCmd = `/usr/sbin/asterisk -rx "channel originate Local/${ext}@from-internal extension ${dest}@from-internal" 2>/dev/null`;
            await execAsync(cliCmd);
            return res.json({
                success: true,
                message: 'Call origination dispatched via CLI fallback',
                extension: ext,
                destination: dest
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. INCOMING STATE ACTION: Answer an incoming ringing call
app.post(['/api/call/answer', '/phone/api/call/answer'], async (req, res) => {
    try {
        const { extension, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active or ringing call found to answer' });
        }

        await execAsync(`/usr/sbin/asterisk -rx "channel redirect ${targetChan} from-internal,${ext},1" 2>/dev/null`).catch(() => ({}));

        res.json({
            success: true,
            message: 'Answer command dispatched',
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. INCOMING STATE ACTION: Reject / Decline an incoming ringing call
app.post(['/api/call/reject', '/phone/api/call/reject', '/api/call/decline', '/phone/api/call/decline'], async (req, res) => {
    try {
        const { extension, channel, reason } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active or ringing call found to reject' });
        }

        const causeCode = (reason === 'busy') ? '17' : '21';
        try {
            await execAmiAction({ Action: 'Hangup', Channel: targetChan, Cause: causeCode });
        } catch (_) {
            await execAsync(`/usr/sbin/asterisk -rx "channel request hangup ${targetChan}" 2>/dev/null`);
        }

        res.json({
            success: true,
            message: 'Incoming call rejected / declined successfully',
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. INCOMING / ACTIVE STATE ACTION: Redirect / Forward call to another destination
app.post(['/api/call/redirect', '/phone/api/call/redirect', '/api/call/forward', '/phone/api/call/forward'], async (req, res) => {
    try {
        const { extension, destination, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const dest = String(destination || req.body?.target || '').trim();
        const chan = String(channel || '').trim();

        if (!dest) return res.status(400).json({ success: false, error: 'Destination is required' });
        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active or ringing call found to redirect' });
        }

        try {
            await execAmiAction({
                Action: 'Redirect',
                Channel: targetChan,
                Context: 'from-internal',
                Exten: dest,
                Priority: '1'
            });
        } catch (_) {
            await execAsync(`/usr/sbin/asterisk -rx "channel redirect ${targetChan} from-internal,${dest},1" 2>/dev/null`);
        }

        res.json({
            success: true,
            message: `Call redirected to ${dest}`,
            channel: targetChan,
            destination: dest,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. OUTGOING STATE ACTION: Cancel an outgoing ringing/dialing call
app.post(['/api/call/cancel', '/phone/api/call/cancel'], async (req, res) => {
    try {
        const { extension, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active or ringing call found to cancel' });
        }

        try {
            await execAmiAction({ Action: 'Hangup', Channel: targetChan, Cause: '16' });
        } catch (_) {
            await execAsync(`/usr/sbin/asterisk -rx "channel request hangup ${targetChan}" 2>/dev/null`);
        }

        res.json({
            success: true,
            message: 'Outgoing call canceled successfully',
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. ACTIVE STATE ACTION: Hangup / Terminate call
app.post(['/api/call/hangup', '/phone/api/call/hangup'], async (req, res) => {
    try {
        const { extension, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found to hangup' });
        }

        try {
            await execAmiAction({ Action: 'Hangup', Channel: targetChan, Cause: '16' });
        } catch (_) {
            await execAsync(`/usr/sbin/asterisk -rx "channel request hangup ${targetChan}" 2>/dev/null`);
        }

        res.json({
            success: true,
            message: 'Call terminated successfully',
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. ACTIVE STATE ACTION: Hold active call
app.post(['/api/call/hold', '/phone/api/call/hold'], async (req, res) => {
    try {
        const { extension, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found to hold' });
        }

        try {
            await execAmiAction({
                Action: 'MuteAudio',
                Channel: targetChan,
                Direction: 'all',
                State: 'on'
            });
        } catch (_) {}

        res.json({
            success: true,
            message: 'Call placed on hold',
            held: true,
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. ACTIVE STATE ACTION: Unhold / Resume active call
app.post(['/api/call/unhold', '/phone/api/call/unhold', '/api/call/resume', '/phone/api/call/resume'], async (req, res) => {
    try {
        const { extension, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found to resume' });
        }

        try {
            await execAmiAction({
                Action: 'MuteAudio',
                Channel: targetChan,
                Direction: 'all',
                State: 'off'
            });
        } catch (_) {}

        res.json({
            success: true,
            message: 'Call resumed from hold',
            held: false,
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. ACTIVE STATE ACTION: Mute audio stream (in, out, or all)
app.post(['/api/call/mute', '/phone/api/call/mute'], async (req, res) => {
    try {
        const { extension, channel, direction } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();
        const dir = ['in', 'out', 'all'].includes(direction) ? direction : 'all';

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found to mute' });
        }

        await execAmiAction({
            Action: 'MuteAudio',
            Channel: targetChan,
            Direction: dir,
            State: 'on'
        });

        res.json({
            success: true,
            message: `Audio muted (${dir})`,
            muted: true,
            direction: dir,
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. ACTIVE STATE ACTION: Unmute audio stream
app.post(['/api/call/unmute', '/phone/api/call/unmute'], async (req, res) => {
    try {
        const { extension, channel, direction } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();
        const dir = ['in', 'out', 'all'].includes(direction) ? direction : 'all';

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found to unmute' });
        }

        await execAmiAction({
            Action: 'MuteAudio',
            Channel: targetChan,
            Direction: dir,
            State: 'off'
        });

        res.json({
            success: true,
            message: `Audio unmuted (${dir})`,
            muted: false,
            direction: dir,
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 12. ACTIVE STATE ACTION: Play DTMF digits
app.post(['/api/call/dtmf', '/phone/api/call/dtmf'], async (req, res) => {
    try {
        const { extension, channel, digits, digit } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();
        const dtmfStr = String(digits || digit || '').trim().replace(/[^0-9A-D*#]/gi, '');

        if (!dtmfStr) return res.status(400).json({ success: false, error: 'Valid DTMF digits required' });
        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found for DTMF playback' });
        }

        for (const char of dtmfStr) {
            await execAmiAction({
                Action: 'PlayDTMF',
                Channel: targetChan,
                Digit: char
            });
        }

        res.json({
            success: true,
            message: `Sent DTMF [${dtmfStr}]`,
            digits: dtmfStr,
            channel: targetChan,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 13. ACTIVE STATE ACTION: Blind Transfer call to destination
app.post(['/api/call/transfer', '/phone/api/call/transfer'], async (req, res) => {
    try {
        const { extension, destination, channel } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const dest = String(destination || req.body?.target || '').trim();
        const chan = String(channel || '').trim();

        if (!dest) return res.status(400).json({ success: false, error: 'Transfer destination is required' });
        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = status.bridgedChannel || chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found to transfer' });
        }

        try {
            await execAmiAction({
                Action: 'Redirect',
                Channel: targetChan,
                Context: 'from-internal',
                Exten: dest,
                Priority: '1'
            });
        } catch (_) {
            await execAsync(`/usr/sbin/asterisk -rx "channel redirect ${targetChan} from-internal,${dest},1" 2>/dev/null`);
        }

        res.json({
            success: true,
            message: `Call successfully transferred to ${dest}`,
            channel: targetChan,
            destination: dest,
            extension: ext
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 14. ACTIVE STATE ACTION: Call Recording Control (MixMonitor)
app.post(['/api/call/record', '/phone/api/call/record'], async (req, res) => {
    try {
        const { extension, channel, action } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        const chan = String(channel || '').trim();
        const act = String(action || 'start').toLowerCase();

        if (!ext && !chan) return res.status(400).json({ success: false, error: 'Extension or channel is required' });

        const status = await getExtensionCallStatus(ext, chan);
        const targetChan = chan || status.channel;

        if (!targetChan) {
            return res.status(404).json({ success: false, error: 'No active call found' });
        }

        if (act === 'start') {
            const filename = `/var/spool/asterisk/monitor/crm-${Date.now()}-${ext || 'call'}.wav`;
            await execAsync(`/usr/sbin/asterisk -rx "mixmonitor start ${targetChan} ${filename}" 2>/dev/null`);
            res.json({ success: true, recording: true, action: 'start', file: filename, channel: targetChan });
        } else {
            await execAsync(`/usr/sbin/asterisk -rx "mixmonitor stop ${targetChan}" 2>/dev/null`);
            res.json({ success: true, recording: false, action: 'stop', channel: targetChan });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 15. EXTENSION CONTROL: Toggle / Set DND (Do Not Disturb)
app.post(['/api/extension/dnd', '/phone/api/extension/dnd'], async (req, res) => {
    try {
        const { extension, enabled } = req.body || {};
        const ext = String(extension || req.query.ext || '').trim();
        if (!ext) return res.status(400).json({ success: false, error: 'Extension is required' });

        const isEnabled = enabled === true || enabled === 'true' || enabled === 1 || enabled === '1';

        if (isEnabled) {
            await execAsteriskCmd(`database put DND ${ext} YES`);
            if (dbPool) {
                try {
                    await dbPool.query('INSERT INTO extension_policies (extension, dnd) VALUES (?, "enabled") ON DUPLICATE KEY UPDATE dnd="enabled"', [ext]);
                } catch (_) {}
            }
        } else {
            await execAsteriskCmd(`database del DND ${ext}`);
            if (dbPool) {
                try {
                    await dbPool.query('INSERT INTO extension_policies (extension, dnd) VALUES (?, "user_choice") ON DUPLICATE KEY UPDATE dnd="user_choice"', [ext]);
                } catch (_) {}
            }
        }

        res.json({
            success: true,
            extension: ext,
            dnd: isEnabled,
            message: `Do Not Disturb ${isEnabled ? 'enabled' : 'disabled'}`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 16. EXTENSION CONTROL: Query registration and extension status
app.get(['/api/extension/status/:ext', '/phone/api/extension/status/:ext'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const ext = String(req.params.ext || '').trim();
    if (!ext) return res.status(400).json({ success: false, error: 'Extension is required' });

    try {
        const dndOut = await execAsteriskCmd(`database get DND ${ext}`);
        const dnd = /Value:\s*YES/i.test(dndOut || '');

        let registered = false;
        let technology = 'sip';
        let ip = null;
        let useragent = null;

        const pjsipOut = await execAsteriskCmd(`pjsip show endpoint ${ext}`);
        if (pjsipOut && !pjsipOut.includes('Unable to find') && !pjsipOut.includes('not found') && !pjsipOut.includes('No such')) {
            technology = 'pjsip';
            registered = /Contact:\s*<[^>]+>\s+[a-f0-9]+\s+Avail/i.test(pjsipOut);
            const uaMatch = pjsipOut.match(/User-Agent:\s*([^\n]+)/i);
            if (uaMatch) useragent = uaMatch[1].trim();
        } else {
            const sipOut = await execAsteriskCmd(`sip show peer ${ext}`);
            technology = 'sip';
            registered = /Status\s*:\s*OK/i.test(sipOut);
            const ipMatch = sipOut.match(/Addr->IP\s*:\s*([0-9.]+)/i);
            if (ipMatch) ip = ipMatch[1].trim();
            const uaMatch = sipOut.match(/Useragent\s*:\s*([^\n]+)/i);
            if (uaMatch) useragent = uaMatch[1].trim();
        }

        const callStatus = await getExtensionCallStatus(ext);

        res.json({
            success: true,
            extension: ext,
            technology,
            registered,
            dnd,
            state: callStatus.state,
            useragent,
            ip,
            activeCall: callStatus.active ? {
                channel: callStatus.channel,
                callId: callStatus.callId,
                direction: callStatus.direction,
                duration: callStatus.duration,
                callerNumber: callStatus.callerNumber,
                destination: callStatus.destination,
                recording: callStatus.recording
            } : null
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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

module.exports = { app, server, resolveTelephonyEndpoint, execAmiAction, getExtensionCallStatus, parseAmiResponse };
