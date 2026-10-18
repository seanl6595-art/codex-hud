'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
test('GUI token formatting uses consistent K/M/B units and sensible rounding', async () => {
  const { compactTokens } = await import('../gui/src/formatters.mjs');
  for (const [value, expected] of [[0,'0'],[999,'999'],[1000,'1K'],[153528,'153.5K'],[1500000,'1.5M'],[31050070,'31.1M'],[1000000000,'1B'],[1000000000000,'1000B'],[999999,'1M']]) {
    assert.equal(compactTokens(value), expected);
  }
});
test('GUI exact token values are retained and missing/nonfinite values are not fabricated', async () => {
  const { compactTokens, exactTokens } = await import('../gui/src/formatters.mjs');
  assert.equal(exactTokens(153528), '153,528'); assert.equal(exactTokens(31050070), '31,050,070');
  assert.equal(exactTokens(12.5), '12.5');
  for (const value of [null,undefined,NaN,Infinity]) {
    assert.equal(exactTokens(value), '—'); assert.equal(compactTokens(value), '—');
  }
});
