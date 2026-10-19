'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {OwnerLease}=require('../src/owner-lease.cjs');
test('sleep/resume timer jumps do not expire a live owner; actual missed opportunities do',()=>{
  const lease=new OwnerLease({limit:3,pauseGap:5000});lease.lastTick=0;assert.equal(lease.tick(1000),false);lease.heartbeat();assert.equal(lease.tick(3600000),false);assert.equal(lease.tick(3601000),false);lease.heartbeat();assert.equal(lease.tick(3602000),false);assert.equal(lease.tick(3603000),false);assert.equal(lease.tick(3604000),true);
});
