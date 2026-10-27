import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {applyChanges,editorPrompt,judgePrompt,refineItems,refinementBatch} from '../lib/refinement.mjs';
import {handle,PUBLIC_ORIGIN} from '../lib/addon.mjs';
import {parseSubtitles} from '../lib/subtitles.mjs';

const items=[{id:7,source:'Are you leaving already?',draft:'את כבר עוזבת?',previous:'We are done talking.',next:'You came here because...',references:[{lang:'es',text:'¿Te vas tan pronto?'}],durationMs:1800,unitIndex:0}];
test('larger review batches preserve every cue and deduplicate only redundant prompt context',()=>{
 const data={cues:Array.from({length:240},(_,i)=>({start:i*4000,end:i*4000+3000,parts:[i]})),units:Array.from({length:240},(_,i)=>({text:`Line ${i}`,translated:'שלום'}))};
 const ids=[];let cursor=0,batches=0;for(;;){const b=refinementBatch(data,cursor);ids.push(...b.items.map(x=>x.id));batches++;cursor=b.next;if(b.done)break;}assert.equal(batches,3);assert.deepEqual(ids,Array.from({length:240},(_,i)=>i+1));
 const b=refinementBatch(data);const prompt=judgePrompt(b.items.map(x=>({...x,candidate:x.draft})));const payload=JSON.parse(prompt.split('DATA:')[1]);assert.equal(payload[1].previous,undefined);assert.equal(payload[1].next,undefined);assert.equal(payload[0].draft,undefined);assert.equal(payload[0].candidate,'שלום');assert.equal(payload.at(-1).next,'Line 96');
});
function gemini(payload){return Response.json({text:JSON.stringify(payload)});}

test('compact editor prompt includes semantic, gender, script, context and readability guards',()=>{
 const prompt=editorPrompt(items,{Yhwach:'יוהאבך'});
 assert.ok(prompt.length<1800);for(const guard of ['English is authoritative','Preserve meaning','Never invent gender','no explanations','Arabic script','read-only context','<=42 chars/line','<=20 chars/sec'])assert.match(prompt,new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('hard validation ignores unknown ids and rejects Arabic or empty replacements',()=>{
 const copy=structuredClone(items),invalid=applyChanges(copy,{changes:[{id:8,text:'לא ידוע'},{id:7,text:'مرحبا'}]});
 assert.deepEqual(invalid,[8,7]);assert.equal(copy[0].candidate,copy[0].draft);
});

test('LangGraph runs editor, judge and one targeted repair',async()=>{
 let calls=0;const fetcher=async(_url,options)=>{calls++;const prompt=JSON.parse(options.body).prompt;
  if(prompt.startsWith('Translate/edit'))return gemini({changes:[{id:7,text:'את כבר הולכת?'}]});
  if(prompt.startsWith('Judge'))return gemini({issues:[{id:7,code:'gender',fix:'Gender is unknown; keep the draft form.'}]});
  assert.match(prompt,/Repair only/);return gemini({changes:[{id:7,text:'את כבר עוזבת?'}]});
 };
 const result=await refineItems(items,{env:{GEMINI_WRAPPER_URL:'https://wrapper.test'},fetcher});
 assert.equal(calls,3);assert.equal(result.failed,false);assert.equal(result.items[0].candidate,'את כבר עוזבת?');assert.equal(result.issues.length,1);
});

test('guest wrapper accepts fenced bare arrays without losing cue ids',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({text:calls===1?'```json\n[{"id":7,"text":"את כבר הולכת?"}]\n```':'[]'});};
 const result=await refineItems(items,{env:{GEMINI_WRAPPER_URL:'https://wrapper.test'},fetcher});
 assert.equal(calls,2);assert.equal(result.failed,false);assert.equal(result.items[0].candidate,'את כבר הולכת?');assert.deepEqual(result.issues,[]);
});

test('official API uses a server-side header, configured model, JSON schema and minimal thinking',async()=>{
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');assert.equal(options.headers['x-goog-api-key'],'private-key');assert.equal(options.redirect,'manual');const body=JSON.parse(options.body);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'minimal');assert.equal(body.generationConfig.responseMimeType,'application/json');assert.ok(body.generationConfig.responseJsonSchema);const result=calls===1?{changes:[{id:7,text:'את כבר הולכת?'}]}:{issues:[]};return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]});};
 const result=await refineItems(items,{env:{GEMINI_API_KEY:'private-key',GEMINI_WRAPPER_URL:'https://unused.test'},fetcher});assert.equal(calls,2);assert.equal(result.failed,false);assert.equal(result.items[0].candidate,'את כבר הולכת?');
});

test('official API quota pauses the job without advancing or redoing Google translation',async()=>{
 const db=database(),env={GEMINI_REFINEMENT_ENABLED:'true',GEMINI_API_KEY:'private-key'};let translations=0,geminiCalls=0;
 const fetcher=async url=>{if(new URL(url).hostname==='api.mymemory.translated.net'){translations++;return Response.json({responseStatus:200,responseData:{translatedText:'טיוטה בעברית'}});}geminiCalls++;return new Response(null,{status:429});};
 const created=await (await handle(request('/api/demo',{key:'he'}),db,fetcher,env)).json();
 const progress=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,fetcher,env)).json();assert.equal(progress.state,'paused');assert.equal(progress.errorCode,'GEMINI_QUOTA');assert.equal(progress.refinement.completed,0);assert.equal(translations,2);assert.equal(geminiCalls,1);
 const resumed=async url=>{if(new URL(url).hostname==='api.mymemory.translated.net')throw new Error('must reuse draft');geminiCalls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(geminiCalls===2?{changes:[]}:{issues:[]})}]}}]});};
 const ready=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,resumed,env)).json();assert.equal(ready.state,'ready');assert.equal(ready.refinement.completed,2);
});

test('truncated API output is rejected and retains the original draft',async()=>{
 const result=await refineItems(items,{env:{GEMINI_API_KEY:'private-key'},fetcher:async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]})});assert.equal(result.failed,true);assert.equal(result.items[0].candidate,items[0].draft);
});

test('Google Translate cooldown blocks pending translation but cannot block Gemini-only review',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GEMINI_REFINEMENT_ENABLED:'true',GEMINI_API_KEY:'private-key'};
 const created=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();
 db.sqlite.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?)').run('cooldown:google','{}',Date.now()+60000);
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');const prompt=JSON.parse(options.body).contents[0].parts[0].text;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(prompt.startsWith('Judge')?{issues:[]}:{changes:[]})}]}}]});};
 const paused=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,fetcher,env)).json();assert.equal(paused.state,'paused');assert.equal(paused.errorCode,'GOOGLE_COOLDOWN');assert.ok(paused.retryAt>Date.now());assert.equal(calls,0);
 const data=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(created.id).data);data.units.forEach(u=>{u.translated='שלום';});db.sqlite.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(data),created.id);
 const ready=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,fetcher,env)).json();assert.equal(ready.state,'ready');assert.equal(ready.retryAt,null);assert.equal(ready.refinement.failedBatches,0);assert.equal(calls,2);
});

function database(){const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};}};},async batch(statements){return Promise.all(statements.map(x=>x.run()));}};}
function request(path,data){return new Request(PUBLIC_ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'192.0.2.20'},body:JSON.stringify(data)});}

test('240-cue end-to-end review needs six API calls instead of twenty, with unchanged SRT timing',async()=>{
 const db=database(),env={GEMINI_REFINEMENT_ENABLED:'true',GEMINI_API_KEY:'private-key'};const created=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();const data=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(created.id).data);data.cues=Array.from({length:240},(_,i)=>({start:i*4000,end:i*4000+3000,parts:[i]}));data.units=Array.from({length:240},(_,i)=>({text:`Line ${i}`,translated:'שלום',attempts:0}));db.sqlite.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(data),created.id);
 let calls=0;const fetcher=async(url,options)=>{calls++;const p=JSON.parse(options.body).contents[0].parts[0].text;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(p.startsWith('Judge')?{issues:[]}:{changes:[]})}]}}]});};
 let p;for(let i=0;i<3;i++)p=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,fetcher,env)).json();assert.equal(p.state,'ready');assert.equal(calls,6);assert.equal(p.timings.geminiRequests,6);assert.equal(p.refinement.completed,240);const output=parseSubtitles(await (await handle(new Request(`${PUBLIC_ORIGIN}/files/${created.id}.srt`),db,fetcher,env)).text());assert.deepEqual(output.map(x=>[x.start,x.end]),data.cues.map(x=>[x.start,x.end]));
});

test('large failed review retries a smaller batch without advancing the saved cursor',async()=>{
 const db=database(),env={GEMINI_REFINEMENT_ENABLED:'true',GEMINI_API_KEY:'private-key'};const created=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();const data=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(created.id).data);data.units.forEach(u=>u.translated='שלום');db.sqlite.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(data),created.id);
 const p=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,async()=>{throw new DOMException('timeout','TimeoutError');},env)).json();assert.equal(p.state,'processing');assert.equal(p.refinement.completed,0);const saved=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(created.id).data);assert.equal(saved.refinement.batchSize,48);assert.ok(saved.units.every(u=>u.translated==='שלום'));
});

test('end-to-end job preserves SRT timing while applying judged Hebrew repair',async()=>{
 const db=database();let geminiCalls=0;
 const fetcher=async(url,options={})=>{const host=new URL(url).hostname;
  if(host==='api.mymemory.translated.net')return Response.json({responseStatus:200,responseData:{translatedText:'טיוטה בעברית'},quotaFinished:false});
  if(host==='wrapper.test'){geminiCalls++;assert.equal(options.headers.Authorization,'Bearer test-token');const prompt=JSON.parse(options.body).prompt;
   if(prompt.startsWith('Translate/edit'))return gemini({changes:[{id:1,text:'שלום, ברוכים הבאים לערב הסרט שלנו.'}]});
   if(prompt.startsWith('Judge'))return gemini({issues:[]});
  }
  throw new Error('unexpected upstream');
 };
 const env={GEMINI_REFINEMENT_ENABLED:'true',GEMINI_WRAPPER_URL:'https://wrapper.test',GEMINI_WRAPPER_TOKEN:'test-token'};
 const created=await (await handle(request('/api/demo',{key:'he'}),db,fetcher,env)).json();
 const progress=await (await handle(request(`/api/jobs/${created.id}/step`,{}),db,fetcher,env)).json();
 assert.equal(progress.state,'ready');assert.equal(progress.refinement.changed,1);assert.equal(geminiCalls,2);
 const file=await handle(new Request(`${PUBLIC_ORIGIN}/files/${created.id}.srt`),db,fetcher,env),output=parseSubtitles(await file.text());
 assert.deepEqual(output.map(x=>[x.start,x.end]),[[1000,3500],[4000,6500]]);assert.match(output[0].text,/ברוכים הבאים/);
});
