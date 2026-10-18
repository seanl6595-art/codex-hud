'use strict';
const { randomInt } = require('node:crypto');
// WHATWG Fetch bad ports: https://fetch.spec.whatwg.org/#port-blocking
const blocked = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,
  101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,
  512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,
  1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
function validatePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('GUI port must be an integer from 0 to 65535.');
  if (blocked.has(port)) throw new Error(`Port ${port} is blocked by web browsers. Use --port 0 or --port 4317.`);
}
async function listenLoopback(server, port) {
  validatePort(port);
  for (let attempt = 0; ; attempt++) {
    // OS dynamic ranges can include Fetch-blocked ports (observed on Windows).
    // Bind directly in the safe high range; never probe then release a port.
    const candidate = port === 0 ? randomInt(49152, 65536) : port;
    try {
      await new Promise((resolve, reject) => {
        function failed(error) { server.off('listening', ready); reject(error); }
        function ready() { server.off('error', failed); resolve(); }
        server.once('error', failed); server.once('listening', ready);
        try { server.listen(candidate, '127.0.0.1'); }
        catch (error) { server.off('error', failed); server.off('listening', ready); reject(error); }
      });
      return;
    } catch (error) {
      if (port !== 0 || attempt >= 19 || !['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
    }
  }
}
module.exports = { listenLoopback, validatePort };
