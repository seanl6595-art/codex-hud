'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { MIN_NODE, supportsNode } = require('../lib/runtime');
const { fixture } = require('./helpers');

test('runtime: the declared minimum matches the validated compatibility boundary', () => {
  assert.equal(MIN_NODE, '24.21.0');
  assert.equal(require('../package.json').engines.node, '>=' + MIN_NODE);
  assert.equal(require('../package-lock.json').packages[''].engines.node, '>=' + MIN_NODE);
  for (const version of ['20.20.0', '22.13.0', '23.11.0', '24.0.0', '24.20.9', '24.21.0-rc.1', 'invalid']) {
    assert.equal(supportsNode(version), false, version);
  }
  // Comparison coverage does not claim these newer runtimes were executed.
  for (const version of ['24.21.0', '24.21.1', '24.22.0', '25.0.0', '26.0.0']) assert.equal(supportsNode(version), true, version);
});

test('runtime: unsupported Recorder, Stats and CLI fail before touching database paths', t => {
  const f = fixture(t), dbPath = path.join(f.home, 'must-not-exist', 'test.sqlite3');
  const script = `
    const assert = require('node:assert/strict');
    Object.defineProperty(process.versions, 'node', { value: '22.13.0' });
    const { openDatabase, openReadOnlyDatabase } = require(process.argv[1]);
    for (const [fn, name] of [[openDatabase, 'Recorder'], [openReadOnlyDatabase, 'Stats']]) {
      assert.throws(() => fn(process.argv[2]), new RegExp(name + ' requires Node.js 24\\.21\\.0'));
    }
    require(process.argv[3]).main(['record', '--once', '--db', process.argv[2]])
      .then(() => { throw Error('unsupported CLI ran'); }, e => assert.match(e.message, /requires Node.js 24\\.21\\.0/));
  `;
  const result = spawnSync(process.execPath, ['-e', script, path.resolve(__dirname, '../lib/recorder-db'), dbPath,
    path.resolve(__dirname, '../lib/cli')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.dirname(dbPath)), false);
});

test('SQLite runtime: a live iterator retains its statement across garbage collection', () => {
  const script = `
    const assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t(n INTEGER); INSERT INTO t VALUES (1),(2),(3)');
    const iterator = db.prepare('SELECT n FROM t ORDER BY n').iterate();
    assert.equal(iterator.next().value.n, 1);
    setImmediate(() => { global.gc(); setImmediate(() => {
      global.gc();
      try { assert.deepEqual([...iterator].map(row => row.n), [2, 3]); }
      finally { db.close(); }
    }); });
  `;
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('filesystem runtime: path and open-descriptor identity stamps agree', t => {
  const f = fixture(t), file = f.write('sessions/identity.jsonl', [{}]), fd = fs.openSync(file, 'r');
  try {
    const { signature } = require('../lib/verified-history-cache');
    assert.equal(signature(fs.statSync(file)), signature(fs.fstatSync(fd)));
  } finally { fs.closeSync(fd); }
});
