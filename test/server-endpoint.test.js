'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTelephonyEndpoint } = require('../server');

test('uses the forwarded hostname for SIP and preserves its port once for WSS', () => {
    assert.deepEqual(
        resolveTelephonyEndpoint({
            host: '127.0.0.1:8090',
            'x-forwarded-host': '192.168.100.128:8443'
        }),
        {
            host: '192.168.100.128',
            defaultWss: 'wss://192.168.100.128:8443/ws'
        }
    );
});

test('uses the first forwarded host supplied by a proxy chain', () => {
    assert.deepEqual(
        resolveTelephonyEndpoint({
            'x-forwarded-host': 'phone.example.test:8443, internal-proxy:8090'
        }),
        {
            host: 'phone.example.test',
            defaultWss: 'wss://phone.example.test:8443/ws'
        }
    );
});

test('retains direct-host behavior when no forwarding header exists', () => {
    assert.deepEqual(
        resolveTelephonyEndpoint({ host: '192.168.100.128:8443' }),
        {
            host: '192.168.100.128',
            defaultWss: 'wss://192.168.100.128:8443/ws'
        }
    );
    assert.deepEqual(
        resolveTelephonyEndpoint({ host: '127.0.0.1:8090' }),
        {
            host: '127.0.0.1',
            defaultWss: 'wss://127.0.0.1/ws'
        }
    );
});
