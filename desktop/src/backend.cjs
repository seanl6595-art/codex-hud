'use strict';
const path=require('node:path');
const {OwnerLease}=require('./owner-lease.cjs');
const {verifyRuntime}=require('./runtime.cjs');
let server,starting,stopping;
const lease=new OwnerLease();
const send=message=>process.parentPort.postMessage(message);
const watchdog=setInterval(()=>{if(lease.tick())void stop('owner-unresponsive');},1000);
async function stop(reason) {
  if(stopping)return stopping;
  stopping=(async()=>{
    const began=performance.now();
    // Preserve the existing queue's graceful stop; SQLite's own atomic recovery
    // remains authoritative if a very large scan exceeds the owner's deadline.
    const deadline=setTimeout(()=>process.exit(2),17000);
    try {if(starting)await starting.catch(()=>{});if(server)await server.close();send({event:'stopped',reason,ms:performance.now()-began});}
    catch{send({event:'stop-error'});}
    finally{clearTimeout(deadline);clearInterval(watchdog);process.exit(0);}
  })();
  return stopping;
}
function failureCode(error) {
  if(['EADDRINUSE','EACCES'].includes(error.code))return error.code;
  if(/assets are missing/.test(error.message))return 'ASSETS_MISSING';
  if(/requires Node.js|SQLite|sqlite/.test(error.message))return 'RUNTIME_UNSUPPORTED';
  return 'BACKEND_START_FAILED';
}
process.parentPort.on('message',({data:message})=>{
  if(message.action==='heartbeat'){lease.heartbeat();return;}
  if(message.action==='stop'){void stop(message.reason||'window-close');return;}
  if(message.action==='start'&&!starting&&!stopping){
    starting=(async()=>{
      const {coreRoot,home,dbPath,port}=message.config;
      const runtime=verifyRuntime(coreRoot);send({event:'runtime',runtime});
      const {startServer}=require(path.join(coreRoot,'lib/gui/server'));
      server=await startServer({home,dbPath,port});
      if(!stopping)send({event:'ready',url:server.url,pid:process.pid,address:server.server.address().address});
    })();
    starting.catch(error=>{send({event:'failure',code:failureCode(error)});void stop('startup-failed');});
  }
});
process.on('SIGTERM',()=>void stop('SIGTERM'));
