'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { listenLoopback, validatePort } = require('../lib/gui/listen');
test('GUI ports: automatic selection never delegates to an unsafe OS dynamic range', async () => {
  const server = new EventEmitter(); let calls = 0;
  server.listen = (port, address) => {
    assert.equal(address, '127.0.0.1'); assert.ok(port >= 49152 && port <= 65535);
    calls++;
    queueMicrotask(() => calls === 1 ? server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })) : server.emit('listening'));
  };
  await listenLoopback(server, 0); assert.equal(calls, 2);
  assert.equal(server.listenerCount('error'), 0); assert.equal(server.listenerCount('listening'), 0);
});
test('GUI ports: explicit blocked ports fail with an actionable message', () => {
  for (const port of [1720, 2049, 6000, 10080]) assert.throws(() => validatePort(port), /blocked by web browsers/);
  for (const port of [0, 80, 443, 4317, 65535]) assert.doesNotThrow(() => validatePort(port));
  for (const port of [-1, 65536, 1.5, '0']) assert.throws(() => validatePort(port), /integer/);
});
test('GUI ports: explicit bind errors do not silently change the requested port', async () => {
  const server = new EventEmitter(); let calls = 0;
  server.listen = (port, address) => { calls++; assert.equal(port, 4317); assert.equal(address, '127.0.0.1');
    queueMicrotask(() => server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }))); };
  await assert.rejects(listenLoopback(server, 4317), { code: 'EADDRINUSE' }); assert.equal(calls, 1);
});
test('GUI ports: automatic bind retries are bounded and clean up listeners', async () => {
  const server = new EventEmitter(); let calls = 0;
  server.listen = () => { calls++; queueMicrotask(() => server.emit('error', Object.assign(new Error('reserved'), { code: 'EACCES' }))); };
  await assert.rejects(listenLoopback(server, 0), { code: 'EACCES' }); assert.equal(calls, 20);
  assert.equal(server.listenerCount('error'), 0); assert.equal(server.listenerCount('listening'), 0);
});
