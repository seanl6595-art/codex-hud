'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMacSigning,JIT,LIBRARY_VALIDATION}=require('../macos-signing.cjs');
const {assertSignature}=require('../scripts/inspect-macos-signatures.cjs');
const processes=['/build/Codex HUD.app','Contents/MacOS/Codex HUD','Contents/Frameworks/Codex HUD Helper.app/Contents/MacOS/Codex HUD Helper','Contents/Frameworks/Codex HUD Helper (Renderer).app/Contents/MacOS/Codex HUD Helper (Renderer)','Contents/Frameworks/Codex HUD Helper (GPU).app','Contents/Frameworks/Codex HUD Helper (Plugin).app'];
const libraries=['Contents/Frameworks/Electron Framework.framework','Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework','Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib','Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler'];
test('internal per-file policy grants only JIT and library loading to Electron processes; Hardened Runtime stays enabled',()=>{
 const signing=createMacSigning();assert.equal(signing.identity,'-');
 for(const file of processes)assert.deepEqual(signing.optionsForFile(file),{hardenedRuntime:true,entitlements:[JIT,LIBRARY_VALIDATION],timestamp:'none'},file);
 for(const file of libraries)assert.deepEqual(signing.optionsForFile(file),{hardenedRuntime:true,entitlements:[],timestamp:'none'},file);
});
test('Developer ID policy requires an explicit identity and keeps library validation with JIT only',()=>{
 assert.throws(()=>createMacSigning({mode:'developer-id'}),/explicit Developer ID/);
 assert.throws(()=>createMacSigning({mode:'unknown'}),/Unknown/);
 const signing=createMacSigning({mode:'developer-id',identity:'Developer ID Application: Test (ABCDE12345)'});
 assert.equal(signing.identityValidation,true);
 for(const file of [...processes,...libraries])assert.deepEqual(signing.optionsForFile(file),{hardenedRuntime:true,entitlements:processes.includes(file)?[JIT]:[]});
});
test('packaged signature gate rejects the original missing-LV regression and weakened or mixed signatures',()=>{
 const row={file:'Contents/MacOS/Codex HUD',details:'CodeDirectory flags=0x10002(adhoc,runtime)\nSignature=adhoc\nTeamIdentifier=not set\n',entitlements:{[JIT]:true,[LIBRARY_VALIDATION]:true}};
 assert.doesNotThrow(()=>assertSignature(row));
 assert.throws(()=>assertSignature({...row,entitlements:{[JIT]:true}}),/missing or excessive/);
 assert.throws(()=>assertSignature({...row,entitlements:{...row.entitlements,'com.apple.security.cs.allow-unsigned-executable-memory':true}}),/missing or excessive/);
 assert.throws(()=>assertSignature({...row,details:row.details.replace(',runtime','')}),/Hardened Runtime/);
 assert.throws(()=>assertSignature({...row,details:row.details.replace('TeamIdentifier=not set','TeamIdentifier=ABCDE12345')}),/unexpected signing team/);
 assert.throws(()=>assertSignature({...row,file:libraries[1]}),/missing or excessive/);
 const signed={...row,details:'CodeDirectory flags=0x10000(runtime)\nAuthority=Developer ID Application: Test (ABCDE12345)\nTeamIdentifier=ABCDE12345\n',entitlements:{[JIT]:true}};
 assert.doesNotThrow(()=>assertSignature(signed,{mode:'developer-id',teamID:'ABCDE12345'}));
 assert.throws(()=>assertSignature({...signed,entitlements:row.entitlements},{mode:'developer-id',teamID:'ABCDE12345'}),/missing or excessive/);
 assert.throws(()=>assertSignature(signed,{mode:'developer-id',teamID:'OTHER12345'}),/team mismatch/);
});
