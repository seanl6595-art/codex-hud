'use strict';
// Count missed timer opportunities, not elapsed wall time: a sleeping PC must not
// look like a dead parent when both processes resume with delayed timers.
class OwnerLease {
  constructor({ limit=10, pauseGap=5000 }={}) { this.limit=limit;this.pauseGap=pauseGap;this.lastTick=performance.now();this.missed=0; }
  heartbeat(){this.missed=0;}
  tick(now=performance.now()) {
    const gap=now-this.lastTick;this.lastTick=now;
    if(gap>this.pauseGap || gap<0){this.missed=0;return false;}
    return ++this.missed>=this.limit;
  }
}
module.exports={OwnerLease};
