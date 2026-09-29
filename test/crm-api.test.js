'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, parseAmiResponse } = require('../server');

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch (_) {}
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: json || data
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Content-Length', Buffer.byteLength(bodyStr));
            req.write(bodyStr);
        }
        req.end();
    });
}

test('CRM API: Unit & Integration Tests for All Telephony States & Actions', async (t) => {
    let serverInstance = null;
    let port = 0;

    await t.test('0. Start ephemeral test server', async () => {
        await new Promise((resolve) => {
            serverInstance = app.listen(0, '127.0.0.1', () => {
                port = serverInstance.address().port;
                resolve();
            });
        });
        assert.ok(port > 0, 'Server listening on ephemeral port');
    });

    await t.test('1. AMI response parser extracts fields and success status', () => {
        const sampleSuccess = 'Response: Success\r\nMessage: Authentication accepted\r\n\r\n';
        const parsedSuccess = parseAmiResponse(sampleSuccess);
        assert.equal(parsedSuccess.success, true);
        assert.equal(parsedSuccess.message, 'Authentication accepted');

        const sampleError = 'Response: Error\r\nMessage: Channel not found\r\n\r\n';
        const parsedError = parseAmiResponse(sampleError);
        assert.equal(parsedError.success, false);
        assert.equal(parsedError.message, 'Channel not found');
    });

    await t.test('2. GET /api/call/state validates required parameters', async () => {
        const res = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/state',
            method: 'GET'
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.error, /ext.*channel/i);
    });

    await t.test('3. GET /api/call/state returns IDLE when extension has no active calls', async () => {
        const res = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/state?ext=9999',
            method: 'GET'
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.state, 'IDLE');
        assert.equal(res.body.active, false);
    });

    await t.test('4. POST /api/call/originate validates extension and destination', async () => {
        const resNoExt = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/originate',
            method: 'POST'
        }, { destination: '101' });
        assert.equal(resNoExt.status, 400);
        assert.equal(resNoExt.body.success, false);
        assert.match(resNoExt.body.error, /extension/i);

        const resNoDest = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/originate',
            method: 'POST'
        }, { extension: '150' });
        assert.equal(resNoDest.status, 400);
        assert.equal(resNoDest.body.success, false);
        assert.match(resNoDest.body.error, /destination/i);
    });

    await t.test('5. POST /api/call/answer validates presence of target and handles missing channel', async () => {
        const resNoTarget = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/answer',
            method: 'POST'
        }, {});
        assert.equal(resNoTarget.status, 400);

        const resIdle = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/answer',
            method: 'POST'
        }, { extension: '9999' });
        assert.equal(resIdle.status, 404);
        assert.equal(resIdle.body.success, false);
    });

    await t.test('6. POST /api/call/reject rejects or reports 404 if idle', async () => {
        const res = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/reject',
            method: 'POST'
        }, { extension: '9999' });
        assert.equal(res.status, 404);
    });

    await t.test('7. POST /api/call/cancel validates targets and handles non-ringing calls', async () => {
        const res = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/cancel',
            method: 'POST'
        }, { extension: '9999' });
        assert.equal(res.status, 404);
    });

    await t.test('8. POST /api/call/hangup terminates call or reports 404', async () => {
        const res = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/hangup',
            method: 'POST'
        }, { extension: '9999' });
        assert.equal(res.status, 404);
    });

    await t.test('9. POST /api/call/hold & unhold validate targets', async () => {
        const resHold = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/hold',
            method: 'POST'
        }, { extension: '9999' });
        assert.equal(resHold.status, 404);

        const resUnhold = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/unhold',
            method: 'POST'
        }, { extension: '9999' });
        assert.equal(resUnhold.status, 404);
    });

    await t.test('10. POST /api/call/mute & unmute validate targets', async () => {
        const resMute = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/mute',
            method: 'POST'
        }, { extension: '9999', direction: 'in' });
        assert.equal(resMute.status, 404);

        const resUnmute = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/unmute',
            method: 'POST'
        }, { extension: '9999', direction: 'out' });
        assert.equal(resUnmute.status, 404);
    });

    await t.test('11. POST /api/call/dtmf validates digits and targets', async () => {
        const resNoDigits = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/dtmf',
            method: 'POST'
        }, { extension: '150', digits: '' });
        assert.equal(resNoDigits.status, 400);

        const resIdle = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/dtmf',
            method: 'POST'
        }, { extension: '9999', digits: '123#' });
        assert.equal(resIdle.status, 404);
    });

    await t.test('12. POST /api/call/transfer & redirect validate destination', async () => {
        const resNoDest = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/transfer',
            method: 'POST'
        }, { extension: '150' });
        assert.equal(resNoDest.status, 400);

        const resRedirectNoDest = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/call/redirect',
            method: 'POST'
        }, { extension: '150' });
        assert.equal(resRedirectNoDest.status, 400);
    });

    await t.test('13. POST /api/extension/dnd toggles DND successfully', async () => {
        const resOn = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/extension/dnd',
            method: 'POST'
        }, { extension: '150', enabled: true });
        assert.equal(resOn.status, 200);
        assert.equal(resOn.body.success, true);
        assert.equal(resOn.body.dnd, true);

        const resOff = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/extension/dnd',
            method: 'POST'
        }, { extension: '150', enabled: false });
        assert.equal(resOff.status, 200);
        assert.equal(resOff.body.success, true);
        assert.equal(resOff.body.dnd, false);
    });

    await t.test('14. GET /api/extension/status/:ext returns technology, registered, and DND status', async () => {
        const res150 = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/extension/status/150',
            method: 'GET'
        });
        assert.equal(res150.status, 200);
        assert.equal(res150.body.success, true);
        assert.equal(res150.body.extension, '150');
        assert.equal(res150.body.technology, 'pjsip');
        assert.equal(res150.body.dnd, false);
        assert.equal(res150.body.state, 'IDLE');

        const res101 = await request({
            hostname: '127.0.0.1',
            port,
            path: '/api/extension/status/101',
            method: 'GET'
        });
        assert.equal(res101.status, 200);
        assert.equal(res101.body.success, true);
        assert.equal(res101.body.extension, '101');
        assert.equal(res101.body.technology, 'sip');
        assert.equal(res101.body.registered, true);
        assert.match(res101.body.useragent, /Cisco/i);
    });

    await t.test('99. Teardown test server', async () => {
        if (serverInstance) {
            await new Promise((resolve) => serverInstance.close(resolve));
        }
    });
});
