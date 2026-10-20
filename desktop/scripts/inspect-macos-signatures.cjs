'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process');
const {requiredEntitlements}=require('../macos-signing.cjs');
function assertSignature(row,{mode='internal',teamID}={}){
  assert.match(row.details,/flags=0x[0-9a-f]+\([^\n)]*\bruntime\b/i,`${row.file}: Hardened Runtime missing`);
  if(mode==='internal'){
    assert.match(row.details,/^Signature=adhoc$/m,`${row.file}: expected ad-hoc signature`);
    assert.match(row.details,/^TeamIdentifier=not set$/m,`${row.file}: unexpected signing team`);
  }else{
    assert.ok(teamID,'Developer ID verification requires the expected Team ID');
    assert.ok(row.details.includes(`TeamIdentifier=${teamID}\n`),`${row.file}: signing team mismatch`);
    assert.match(row.details,/^Authority=Developer ID Application: /m);
  }
  const expected=Object.fromEntries(requiredEntitlements(row.file,mode).map(key=>[key,true]));
  assert.deepEqual(row.entitlements,expected,`${row.file}: missing or excessive entitlements`);
}
function machoFiles(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(dir,entry.name);if(entry.isSymbolicLink())return[];
    if(entry.isDirectory())return machoFiles(file);
    if(!entry.isFile())return[];
    const fd=fs.openSync(file,'r'),head=Buffer.alloc(4);try{fs.readSync(fd,head,0,4,0);}finally{fs.closeSync(fd);}
    return ['cffaedfe','cefaedfe','feedfacf','feedface','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(head.toString('hex'))?[file]:[];
  });
}
function inspectMacSignatures(app,options={}){
  if(process.platform!=='darwin')throw Error('Signature inspection requires native macOS codesign');
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
  const binaries=machoFiles(path.join(app,'Contents'));
  for(const suffix of ['Contents/MacOS/Codex HUD','Electron Framework.framework/Versions/A/Electron Framework','Codex HUD Helper.app/Contents/MacOS/Codex HUD Helper','Codex HUD Helper (Renderer).app/Contents/MacOS/Codex HUD Helper (Renderer)','Codex HUD Helper (GPU).app/Contents/MacOS/Codex HUD Helper (GPU)'])assert.ok(binaries.some(file=>file.endsWith(suffix)),`Missing signed binary: ${suffix}`);
  const rows=binaries.map(file=>{
    execFileSync('/usr/bin/codesign',['--verify','--strict',file],{stdio:'pipe'});
    const display=spawnSync('/usr/bin/codesign',['--display','--verbose=4',file],{encoding:'utf8'});assert.equal(display.status,0,display.stderr);
    const ent=spawnSync('/usr/bin/codesign',['--display','--entitlements',':-',file],{encoding:'utf8'});assert.equal(ent.status,0,ent.stderr);
    const entitlements=ent.stdout.trim()?JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-','--','-'],{input:ent.stdout,encoding:'utf8'})):{};
    const row={file:path.relative(app,file).replaceAll('\\','/'),details:(display.stdout+display.stderr).replaceAll(app,'<APP>'),entitlements};assertSignature(row,options);return row;
  });
  // Inspect the bundle seal as well as the executable, including its entitlements.
  const display=spawnSync('/usr/bin/codesign',['--display','--verbose=4',app],{encoding:'utf8'});assert.equal(display.status,0,display.stderr);
  const main=rows.find(row=>row.file==='Contents/MacOS/Codex HUD');
  assertSignature({file:app,details:display.stdout+display.stderr,entitlements:main.entitlements},options);
  return{mode:options.mode||'internal',binaries:rows};
}
if(require.main===module){try{console.log(JSON.stringify(inspectMacSignatures(path.resolve(process.argv[2])),null,2));}catch(error){console.error(error);process.exitCode=1;}}
module.exports={inspectMacSignatures,assertSignature};
