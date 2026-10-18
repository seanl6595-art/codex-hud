'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { defaultCodexHome } = require('../sessions');
const { defaultDatabasePath } = require('../recorder-db');
const { resolvePeriod } = require('../stats');
const { heatmapPeriod } = require('../stats-buckets');
class WorkerClient {
  constructor(file, options, onStatus = () => {}) {
    this.worker = new Worker(path.join(__dirname, file), { workerData: options });
    this.pending = new Map(); this.seq = 0; this.failure = null;
    this.worker.on('message', m => {
      if (m.event === 'status') return onStatus(m.data);
      const item = this.pending.get(m.id); if (!item) return;
      this.pending.delete(m.id); m.error ? item.reject(Object.assign(new Error(m.error.message), { code: m.error.code })) : item.resolve(m.data);
    });
    const fail = e => { this.failure = e; for (const p of this.pending.values()) p.reject(e); this.pending.clear(); };
    this.worker.on('error', fail);
    this.worker.on('exit', code => fail(new Error('Local data worker stopped (' + code + ').')));
  }
  call(method, args = {}) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.seq; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, method, args });
    });
  }
  close() { return this.worker.terminate(); }
}
function createService(options = {}) {
  const config = { home: path.resolve(options.home || defaultCodexHome()),
    dbPath: path.resolve(options.dbPath || defaultDatabasePath()), interval: options.interval || 2000 };
  let state = { running: false, busy: false, lastSync: null, lastError: null, summary: null };
  const reader = new WorkerClient('data-worker.js', config);
  const statistics = new WorkerClient('data-worker.js', config);
  const metadata = new WorkerClient('data-worker.js', config);
  const recorder = new WorkerClient('recorder-worker.js', config, next => { state = next; });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    config, timezone,
    async stats(params) {
      const zone = params.get('timezone') || timezone, range = params.get('range') || '24h', now = Date.now();
      let options;
      if (range === 'absolute') options = { from: params.get('from') || undefined, to: params.get('to') || undefined, timezone: zone };
      else if (range === 'custom') options = { from: params.get('from') || undefined, to: params.get('to') || undefined,
        localInput: true, timezone: zone };
      else {
        const hours = range === 'lookback' ? Number(params.get('hours')) : { '24h': 24, '48h': 48, '7d': 168, '30d': 720 }[range];
        if (!Number.isFinite(hours) || hours < 1 || hours > 8784) throw new Error('Lookback must be between 1 and 8784 hours.');
        options = { from: new Date(now - hours * 3600000).toISOString(), to: new Date(now).toISOString(), timezone: zone };
      }
      if (['custom', 'absolute'].includes(range) && (!options.from || !options.to)) throw new Error('Choose both a start and end time.');
      const period = resolvePeriod(options);
      if (period.end - period.start > 366 * 86400000) throw new Error('Choose a range of at most 366 days.');
      const buckets = period.end - period.start <= 48 * 3600000 ? 'hour' : 'day';
      const filters = {};
      for (const key of ['model', 'effort']) if (params.has(key)) {
        const value = JSON.parse(params.get(key));
        if (value !== null && (typeof value !== 'string' || value.length > 300)) throw new Error('Invalid analytics filter.');
        filters[key] = value;
      }
      const verification = params.get('verification') || 'snapshot';
      if (!['snapshot', 'fresh'].includes(verification)) throw new Error('Invalid verification mode.');
      return statistics.call('stats', { ...period, buckets, analytics: params.get('analytics') !== '0', filters, verification });
    },
    heatmap(zone = timezone, weeks = 12, offset = 0) { return statistics.call('stats', heatmapPeriod(Date.now(), zone, Number(weeks), Number(offset))); },
    sessions: () => reader.call('sessions'),
    detail: id => reader.call('detail', { id }),
    async status() { return { ...state, ...await metadata.call('metadata'), dbPath: config.dbPath,
      ownership: 'Controls affect this GUI recorder only. External CLI recorder status is unknown.' }; },
    control: action => recorder.call(action),
    diagnostics: () => reader.call('diagnostics'),
    async close() { try { await recorder.call('stop'); } finally { await Promise.all([reader.close(), statistics.close(), metadata.close(), recorder.close()]); } }
  };
}
module.exports = { createService };
