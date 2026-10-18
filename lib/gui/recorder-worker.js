'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { Recorder } = require('../recorder');
let recorder, timer, running = false, queue = Promise.resolve();
const status = { running: false, busy: false, lastSync: null, lastError: null, summary: null };
const publish = () => parentPort.postMessage({ event: 'status', data: { ...status } });
async function scan() {
  status.busy = true; publish();
  try {
    recorder ||= new Recorder(workerData);
    status.summary = await recorder.scan();
    status.lastSync = new Date().toISOString();
    // Per-source outcomes belong to the detailed sync result. lastError is fatal.
    status.lastError = null;
  } catch (e) { status.lastError = e.code || 'Recorder could not sync the local database.'; throw new Error(status.lastError); }
  finally { status.busy = false; publish(); }
}
function schedule() {
  clearTimeout(timer);
  if (running) timer = setTimeout(() => {
    queue = queue.then(async () => { if (running) { try { await scan(); } catch {} schedule(); } });
  }, workerData.interval);
}
parentPort.on('message', message => {
  queue = queue.then(async () => {
    try {
      if (message.method === 'stop') {
        running = false; clearTimeout(timer); status.running = false;
        if (recorder) { recorder.close(); recorder = null; }
      } else if (message.method === 'start') {
        if (!running) {
          running = true; status.running = true;
          try { await scan(); } catch (e) { running = false; status.running = false; throw e; }
          schedule();
        }
      } else if (message.method === 'sync') {
        try { await scan(); } finally { if (!running && recorder) { recorder.close(); recorder = null; } }
      } else throw new Error('Unknown recorder action.');
      publish(); parentPort.postMessage({ id: message.id, data: { ...status } });
    } catch (e) { publish(); parentPort.postMessage({ id: message.id, error: { message: e.message, code: 'RECORDER_ERROR' } }); }
  });
});
