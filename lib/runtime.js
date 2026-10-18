'use strict';
const MIN_NODE = '24.21.0';
function supportsNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split('.').map(Number), minimum = MIN_NODE.split('.').map(Number);
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}
function assertSupportedNode(feature = 'Codex HUD') {
  if (!supportsNode(process.versions.node)) {
    throw new Error(`${feature} requires Node.js ${MIN_NODE} or newer with built-in node:sqlite; found ${process.version}.`);
  }
}
module.exports = { MIN_NODE, supportsNode, assertSupportedNode };
