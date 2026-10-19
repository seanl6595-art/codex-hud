'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allowedRequest,allowedNavigation,shellResource,trustedSender}=require('../src/security.cjs');
test('only exact shell files and owned numeric loopback origin are allowed',()=>{
  const origin='http://127.0.0.1:54321';assert.ok(allowedRequest(origin+'/api/stats',origin));assert.ok(allowedNavigation(origin+'/#dashboard',origin));assert.ok(shellResource('codex-hud://shell/index.html?lang=en'));
  for(const url of ['http://localhost:54321/','http://127.0.0.1:54322/','http://127.0.0.1.attacker.test:54321/','http://user@127.0.0.1:54321/','https://example.com/','file:///C:/private.txt','data:text/html,hello','codex-hud://shell/../secrets','codex-hud://evil/index.html','codex-hud://shell/src/main.cjs','codex-hud://shell:90/index.html'])assert.equal(allowedRequest(url,origin),false,url);
  assert.equal(allowedNavigation(origin+'/api/bootstrap',origin),false);assert.equal(allowedNavigation(origin+'/?foreign=1',origin),false);assert.equal(allowedRequest(origin+'/',null),false);
});
test('UI IPC accepts only the owned GUI main frame on its current backend origin',()=>{
  const frame={url:'http://127.0.0.1:54321/'},contents={mainFrame:frame};assert.ok(trustedSender({sender:contents,senderFrame:frame},contents,'http://127.0.0.1:54321'));
  assert.equal(trustedSender({sender:contents,senderFrame:{url:frame.url}},contents,'http://127.0.0.1:54321'),false);
  frame.url='codex-hud://shell/index.html';assert.equal(trustedSender({sender:contents,senderFrame:frame},contents,'http://127.0.0.1:54321'),false);
});
