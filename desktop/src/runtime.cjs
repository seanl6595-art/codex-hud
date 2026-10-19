'use strict';
function verifyRuntime(coreRoot) {
  require(require('node:path').join(coreRoot,'lib/runtime')).assertSupportedNode('Codex HUD Desktop');
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE runtime_probe (n INTEGER) STRICT; BEGIN IMMEDIATE; INSERT INTO runtime_probe VALUES (1); ROLLBACK;');
    if(db.prepare('SELECT count(*) AS n FROM runtime_probe').get().n!==0)throw new Error('SQLite rollback failed.');
    db.exec('BEGIN IMMEDIATE; INSERT INTO runtime_probe VALUES (2); COMMIT;');
    if(db.prepare('SELECT n FROM runtime_probe').get().n!==2)throw new Error('SQLite commit failed.');
    return {node:process.versions.node,electron:process.versions.electron,sqlite:process.versions.sqlite,platform:process.platform,arch:process.arch,transactions:true};
  } finally {db.close();}
}
module.exports={verifyRuntime};
