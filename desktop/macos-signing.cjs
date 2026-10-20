'use strict';
// Per-file options are the @electron/osx-sign 2.x API. Top-level entitlements,
// hardenedRuntime and timestamp do not override its per-file defaults.
const JIT='com.apple.security.cs.allow-jit';
const LIBRARY_VALIDATION='com.apple.security.cs.disable-library-validation';
function isElectronProcess(file){
  return /\.app$/.test(file)||/(?:^|\.app[/\\])Contents[/\\]MacOS[/\\][^/\\]+$/.test(file);
}
function requiredEntitlements(file,mode='internal'){
  if(!['internal','developer-id'].includes(mode))throw Error('Unknown macOS signing mode');
  return isElectronProcess(file)?[JIT,...(mode==='internal'?[LIBRARY_VALIDATION]:[])]:[];
}
function createMacSigning({mode='internal',identity}={}){
  if(!['internal','developer-id'].includes(mode))throw Error('Unknown macOS signing mode');
  if(mode==='developer-id'&&(!identity||!identity.startsWith('Developer ID Application: ')))throw Error('An explicit Developer ID Application identity is required');
  if(mode==='internal'&&identity&&identity!=='-')throw Error('Internal builds require ad-hoc signing');
  return{
    identity:mode==='internal'?'-':identity,identityValidation:mode!=='internal',
    preEmbedProvisioningProfile:false,preAutoEntitlements:false,continueOnError:false,
    optionsForFile:file=>({hardenedRuntime:true,entitlements:requiredEntitlements(file,mode),...(mode==='internal'?{timestamp:'none'}:{})})
  };
}
module.exports={createMacSigning,requiredEntitlements,isElectronProcess,JIT,LIBRARY_VALIDATION};
