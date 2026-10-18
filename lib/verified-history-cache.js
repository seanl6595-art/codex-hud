'use strict';
const fs = require('node:fs');

// Memory-only certificates of a previously cryptographically verified committed
// source/sequence. Keys bind the DB facts and verifier versions, NOT file metadata.
// Metadata is only a conservative eviction signal; a hit does not attest that
// arbitrary external file mutations have not happened since verification.
const proofs = new Map();
const MAX_PROOFS = 1024, MAX_EVENTS = 250000;
let events = 0;
const signature = s => s.isFile() ? [s.dev, s.ino, s.birthtimeMs, s.ctimeMs, s.mtimeMs, s.size].join(':') : null;
function stamp(file) {
  try {
    const s = fs.statSync(file);
    return signature(s);
  } catch { return null; }
}
function remove(key) {
  const old = proofs.get(key);
  if (old) { events -= old.weight; proofs.delete(key); }
}
function get(key) {
  const proof = proofs.get(key);
  if (!proof) return null;
  if (!proof.stamp || stamp(proof.file) !== proof.stamp) { remove(key); return null; }
  proofs.delete(key); proofs.set(key, proof);
  return proof.result;
}
function put(key, result) {
  remove(key);
  if (!result?.kinds || !result.file || !result.fileStamp || result.kinds.size > MAX_EVENTS) return;
  const weight = result.kinds.size;
  while (proofs.size >= MAX_PROOFS || events + weight > MAX_EVENTS) remove(proofs.keys().next().value);
  proofs.set(key, { result, file: result.file, stamp: result.fileStamp, weight }); events += weight;
}
function getConflict(key) {
  const storedKey = 'conflict:' + key, proof = proofs.get(storedKey);
  if (!proof) return null;
  proofs.delete(storedKey); proofs.set(storedKey, proof);
  // A witnessed contradiction about these exact DB facts is not repaired by
  // deleting/changing its source file. Only a different binding can supersede it.
  return proof.result;
}
function putConflict(key, result) {
  const storedKey = 'conflict:' + key; remove(storedKey);
  while (proofs.size >= MAX_PROOFS || events + 1 > MAX_EVENTS) remove(proofs.keys().next().value);
  proofs.set(storedKey, { result, weight: 1 }); events++;
}
function clear() { proofs.clear(); events = 0; }
module.exports = { get, put, getConflict, putConflict, remove, clear, stamp, signature };
