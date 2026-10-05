'use strict';
const { JsonlStore } = require('./jsonl');
const { listSessions } = require('./sessions');
const { parseTelemetry } = require('./telemetry');
const { loadSubscription } = require('./subscription');
class DataSource {
  constructor(home) { this.home = home; this.store = new JsonlStore(); }
  list() { return listSessions(this.home, this.store); }
  async view(session, now = Date.now()) {
    const [data, subscription] = await Promise.all([
      session?.file ? this.store.read(session.file) : Promise.resolve({ records: [], error: 'NO_SESSION' }),
      loadSubscription(this.home, this.store, now),
    ]);
    return { session: session || null, telemetry: session ? parseTelemetry(data.records, data) : null, subscription };
  }
}
module.exports = { DataSource };
