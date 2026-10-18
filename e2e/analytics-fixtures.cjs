'use strict';
const {openDatabase} = require('../lib/recorder-db');
// Illustrative local-only sources with model/effort transitions and large Input/small Output.
function addAnalyticsData(fixture) {
  const db=openDatabase(fixture.dbPath), columns=['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'];
  try {
    db.exec('BEGIN');
    const source=db.prepare("INSERT INTO sources (session_id,current_path,checkpoint_byte_offset,last_event_seq,anchor_start_offset,anchor_end_offset,anchor_sha256,last_seen_file_size,updated_at) VALUES (?, 'synthetic-analytics', 0, 0, 0, 0, 'synthetic-only', 0, ?)");
    const event=db.prepare('INSERT INTO telemetry_events (session_id,event_seq,event_timestamp,model,reasoning_effort,turn_id,'+columns.flatMap(c=>[c,'cumulative_'+c]).join(',')+') VALUES ('+Array(14).fill('?').join(',')+')');
    for(let j=0;j<3;j++){
      const id='synthetic-analytics-'+j;source.run(id,new Date().toISOString());const current=[0,0,0,0];let seq=0;
      for(let i=0;i<168;i++){
        if(i%9===4)continue;
        const stamp=new Date(Date.now()-(168-i)*3600000).toISOString(),input=i%13===0?0:Math.round([.2,.6,.9,.4,1,.8][i%6]*(j+1)*4300000);
        const last=[input,Math.round(input*.72),Math.round(input*.009),Math.round(input*.003)];last.forEach((v,k)=>current[k]+=v);
        event.run(id,++seq,stamp,i%31===0?null:['synthetic-model-alpha','synthetic-model-beta','synthetic-model-gamma'][(j+Math.floor(i/36))%3],i%29===0?null:['low','medium','high'][Math.floor(i/12)%3],i%37===0?null:'synthetic-turn-'+Math.floor(i/2),...columns.flatMap((_,k)=>[last[k],current[k]]));
      }
    }
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
}
module.exports={addAnalyticsData};
