import test from 'node:test';
import assert from 'node:assert/strict';
import {processQueue,retryItems} from '../lib/queue.mjs';
const item=(n,state='queued',extra={})=>({id:`tt14986406:1:${n}`,season:1,episode:n,state,progress:0,...extra});
const queue=items=>({key:'he',items});
test('automatic matching bypasses release discovery for saved manual queues and per-episode overrides',async()=>{
 for(const q of [{...queue([item(1,'awaiting-release')]),releaseMode:'auto'},{...queue([item(1,'awaiting-release',{releaseAuto:true})]),releaseMode:'manual'}]){
  let calls=0;await processQueue(q,{save(){},stopMode:()=>'',api:async(path,body)=>{calls++;assert.equal(path,'/api/prepare');assert.equal(body.releaseId,undefined);return {bridge:{state:'existing'},subtitles:[]};}});assert.equal(calls,1);assert.equal(q.items[0].state,'existing');
 }
});
test('manual queue waits for a release and passes the saved choice on resume',async()=>{
 const q={...queue([item(1),item(2)]),releaseMode:'manual'};let calls=0;const api=async(path,body)=>{calls++;assert.equal(path,'/api/prepare');assert.equal(body.releaseId,'chosen');return {bridge:{state:'existing',release:'1080p WEB-DL Group'},subtitles:[{url:'https://example.test/a.srt'}]};};
 await processQueue(q,{api,save(){},stopMode:()=>''});assert.equal(calls,0);assert.equal(q.items[0].state,'awaiting-release');
 q.items[0].releaseId='chosen';await processQueue(q,{api,save(){},stopMode:()=>''});assert.equal(calls,1);assert.equal(q.items[0].state,'existing');assert.equal(q.items[0].releaseLabel,'1080p WEB-DL Group');assert.equal(q.items[1].state,'awaiting-release');
});
test('finish-episode pause finishes every segment but never starts the next episode',async()=>{
 const q=queue([item(1),item(2)]);let mode='',steps=0;const calls=[];
 await processQueue(q,{save(){},stopMode:()=>mode,api:async(path,body)=>{
  calls.push([path,body]);if(path==='/api/prepare')return {bridge:{id:'job1',state:'pending',progress:0}};
  steps++;mode='episode';return {state:steps===3?'ready':'processing',progress:steps*100/3};
 }});
 assert.equal(steps,3);assert.equal(q.items[0].state,'ready');assert.equal(q.items[0].url,'/files/job1.srt');assert.equal(q.items[1].state,'queued');assert.equal(calls.filter(x=>x[0]==='/api/prepare').length,1);
});
test('request pause checkpoints and resumes without repeating discovery or completed work',async()=>{
 const q=queue([item(1)]);let mode='',steps=0,discovery=0;
 const api=async path=>{if(path==='/api/prepare'){discovery++;return {bridge:{id:'job',state:'pending',progress:0}};}steps++;mode='request';return {state:steps===2?'ready':'processing',progress:steps*50};};
 await processQueue(q,{api,save(){},stopMode:()=>mode});assert.equal(q.items[0].progress,50);assert.equal(steps,1);
 mode='';await processQueue(q,{api,save(){},stopMode:()=>mode});assert.equal(q.items[0].state,'ready');assert.equal(discovery,1);assert.equal(steps,2);
});
test('finish-episode pause also stops after an existing or missing track',async()=>{
 for(const state of ['existing','missing']){const q=queue([item(1),item(2)]);let mode='',calls=0;await processQueue(q,{save(){},stopMode:()=>mode,api:async()=>{calls++;mode='episode';return {bridge:{state},subtitles:[]};}});assert.equal(calls,1);assert.equal(q.items[1].state,'queued');}
});
test('retry only selected failures and retain valid partial jobs, clearing expired ones',async()=>{
 const items=[item(1,'ready'),item(2,'error',{jobId:'partial',progress:60,expires:9999,error:'quota'}),item(3,'skipped',{jobId:'expired',expires:1,progress:20}),item(4),item(5,'missing')];
 const ids=[items[1].id,items[2].id],q=queue(retryItems(items,ids,100));
 assert.equal(q.items[1].jobId,'partial');assert.equal(q.items[1].progress,60);assert.equal(q.items[1].error,undefined);assert.equal(q.items[2].jobId,undefined);assert.equal(items[1].state,'error');
 const paths=[];await processQueue(q,{onlyIds:ids,now:()=>100,stopMode:()=>'',save(){},api:async(path,body)=>{paths.push(path);return path==='/api/prepare'?{bridge:{state:'existing'},subtitles:[]}:{state:'ready',progress:100};}});
 assert.deepEqual(paths,['/api/jobs/partial/step','/api/prepare']);assert.equal(q.items[3].state,'queued');assert.equal(q.items[4].state,'missing');
});
test('provider failure still pauses immediately when finish-episode is scheduled',async()=>{
 const q=queue([item(1,'pending',{jobId:'job'}),item(2)]);let mode='';await assert.rejects(processQueue(q,{save(){},stopMode:()=>mode,api:async()=>{mode='episode';return {state:'paused',progress:10,error:'quota reached'};}}),/quota reached/);assert.equal(q.items[0].state,'error');assert.equal(q.items[0].jobId,'job');assert.equal(q.items[1].state,'queued');
});
test('expired server job is rediscovered on next retry',async()=>{
 const q=queue([item(1,'pending',{jobId:'gone'})]);await assert.rejects(processQueue(q,{save(){},stopMode:()=>'',api:async()=>{throw Object.assign(new Error('expired'),{code:'JOB'});}}));assert.equal(q.items[0].jobId,undefined);assert.equal(retryItems(q.items,[q.items[0].id])[0].state,'queued');
});
