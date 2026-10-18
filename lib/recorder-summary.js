'use strict';
function counts(items = []) {
  const grouped = new Map();
  for(const item of items)grouped.set(item.code,(grouped.get(item.code)||0)+1);
  return [...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>({code,count}));
}
function collectionResult(summary) {
  return {...summary,outcome:summary.errors.length ? summary.scanned_sources ? 'partial' : 'failed' : summary.partial_sources || summary.skipped_sources ? 'partial' : 'complete',
    error_types:counts(summary.errors),skip_types:counts(summary.skips),failed_source_history_preserved:true};
}
module.exports = {collectionResult};
