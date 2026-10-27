import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {validateEntities,mergeEntities,enforceMemory,memorySlice,curateStep,memoryKey,readMemory} from '../lib/series-memory.mjs';
import {editorPrompt,judgePrompt,repairPrompt} from '../lib/refinement.mjs';
import {handle,PUBLIC_ORIGIN} from '../lib/addon.mjs';
import {parseSubtitles} from '../lib/subtitles.mjs';
const entity={name:'Nelliel',he:'נליאל',kind:'character',aliases:['Nel'],variants:['נלייל'],gender:'female',cue:1,quote:'Nelliel is his sister.'};
const items=[{id:1,source:'Nelliel is his sister.',draft:'נלייל היא אחותו.'}];
function database(){const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};}};},async batch(s){return Promise.all(s.map(x=>x.run()));}};}
const response=value=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
test('curation requires exact source evidence and never trusts gender from prior knowledge',()=>{
 const accepted=validateEntities({entities:[entity,{...entity,name:'Invented'}, {...entity,name:'Nelliel',quote:'She is a woman.'}]},items);
 assert.equal(accepted.length,1);assert.equal(accepted[0].gender,'female');assert.deepEqual(accepted[0].aliases,[]);
 const unknown=validateEntities({entities:[{...entity,quote:'Nelliel',gender:'female'}]},items);assert.equal(unknown[0].gender,'unknown');
});
test('series merges lock spelling, preserve evidence and reject conflicting gender',()=>{
 const first=mergeEntities([],validateEntities({entities:[entity]},items),'tt1:1:1');
 const second=mergeEntities(first,[{...first[0],he:'נלייל',gender:'male'}],'tt1:1:2');
 assert.equal(second.length,1);assert.equal(second[0].he,'נליאל');assert.equal(second[0].gender,'unknown');assert.ok(second[0].genderConflict);assert.equal(second[0].evidence.episode,'tt1:1:1');assert.equal(first[0].gender,'female');
});
test('relevant context reaches all three passes and exact term normalization is source guarded',()=>{
 const entities=mergeEntities([],validateEntities({entities:[entity]},items),'tt1');const memory=memorySlice(entities,[{source:'Nelliel is here.'}]);assert.equal(memory.length,1);assert.deepEqual(memorySlice(entities,[{source:'Nothing to see.'}]),[]);
 for(const prompt of [editorPrompt(items,{},memory),judgePrompt(items,memory),repairPrompt(items,[],{},memory)]){assert.match(prompt,/נליאל/);assert.match(prompt,/never an assumed speaker/);}
 assert.equal(enforceMemory('Nelliel returns.','ונלייל חזרה.',entities),'ונליאל חזרה.');assert.equal(enforceMemory('Someone else returns.','נלייל חזרה.',entities),'נלייל חזרה.');
 assert.equal(enforceMemory('Nelliel returns.','Nelliel חזרה.',entities),'נליאל חזרה.');
});
test('large first passes checkpoint all cues, cache JSON and preserve established spelling across episodes',async()=>{
 const db=database(),env={GEMINI_API_KEY:'test'},units=Array.from({length:130},(_,i)=>({text:`Nelliel ${'word '.repeat(100)} ${i}`,translated:'נלייל'})),data={mediaId:'tt1234567',episodeId:'tt1234567:1:1',target:'he',units,cues:units.map((_,i)=>({parts:[i]}))};let calls=0;
 const fetcher=async(_url,options)=>{calls++;const p=JSON.parse(options.body).contents[0].parts[0].text;const selected=JSON.parse(p.split('DATA:')[1]);return response({entities:[{...entity,quote:'Nelliel',cue:selected[0].id}]});};
 while(!data.seriesMemory?.done)await curateStep(db,data,{env,fetcher});assert.ok(calls>1);assert.equal(data.seriesMemory.cursor,130);const saved=await readMemory(db,memoryKey(data.mediaId,'he','gemini-3.5-flash-lite'));assert.equal(saved.entities[0].he,'נליאל');
 const second={...data,episodeId:'tt1234567:1:2',seriesMemory:undefined};await curateStep(db,second,{env,fetcher:async()=>response({entities:[{...entity,he:'נלייל',quote:'Nelliel'}]})});assert.equal(second.seriesMemory.entities[0].he,'נליאל');
});
test('real pipeline curates before translation and upgrades cached drafts without retranslating',async()=>{
 const db=database(),env={GEMINI_REFINEMENT_ENABLED:'true',GEMINI_API_KEY:'test'};
 const source='1\n00:00:01,000 --> 00:00:04,000\nNelliel is his sister.\n\n2\n00:00:05,000 --> 00:00:08,000\nNelliel returns.\n';let translations=0,curations=0;
 const fetcher=async(url,options)=>{const host=new URL(url).hostname;if(String(url).includes('/subtitles/'))return Response.json({subtitles:[{id:'en',lang:'eng',url:'https://subs5.strem.io/file'}]});if(host==='subs5.strem.io')return new Response(source);if(host==='api.mymemory.translated.net'){translations++;return Response.json({responseStatus:200,responseData:{translatedText:'נלייל חזרה.'}});}const p=JSON.parse(options.body).contents[0].parts[0].text;if(p.startsWith('Build a reusable')){curations++;return response({entities:[entity]});}assert.match(p,/נליאל/);return response(p.startsWith('Judge')?{issues:[]}:{changes:[{id:1,text:'נליאל היא אחותו.'},{id:2,text:'נליאל חזרה.'}]});};
 const req=name=>new Request(PUBLIC_ORIGIN+'/addon/he/subtitles/series/tt1234567%3A1%3A1/filename='+name+'.json');const first=await(await handle(req('a'),db,fetcher,env)).json();const id=first.bridge.id;
 const post=()=>handle(new Request(`${PUBLIC_ORIGIN}/api/jobs/${id}/step`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),db,fetcher,env);
 let p=await(await post()).json();assert.equal(curations,1);assert.equal(translations,0);assert.equal(p.seriesContext.done,true);p=await(await post()).json();assert.equal(p.state,'ready');assert.equal(translations,2);
 const before=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(id).data);delete before.seriesMemory;before.units.forEach(u=>u.translated='נלייל חזרה.');db.sqlite.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(before),id);
 const oldFile=await handle(new Request(`${PUBLIC_ORIGIN}/files/${id}.srt`),db,fetcher,env);const oldTag=oldFile.headers.get('ETag');await oldFile.text();
 const upgraded=await(await handle(req('b'),db,fetcher,env)).json();assert.equal(upgraded.bridge.id,id);assert.equal(upgraded.bridge.state,'processing');await post();p=await(await post()).json();assert.equal(p.state,'ready');assert.equal(translations,2);
 const downloaded=await handle(new Request(`${PUBLIC_ORIGIN}/files/${id}.srt`,{headers:{'If-None-Match':oldTag}}),db,fetcher,env);assert.equal(downloaded.status,200);assert.notEqual(downloaded.headers.get('ETag'),oldTag);assert.match(downloaded.headers.get('ETag'),/^\"srt-v2-/);
 const file=await downloaded.text();const cues=parseSubtitles(file);assert.deepEqual(cues.map(c=>[c.start,c.end]),[[1000,4000],[5000,8000]]);assert.ok(!file.includes('נלייל'));
});
test('name normalization preserves explicit honorifics and repairs a dropped title without duplication',()=>{
 const e={name:'Kurosaki',he:'קורוסאקי',aliases:[],variants:['מר קורוסאקי'],kind:'character',gender:'unknown'};
 assert.equal(enforceMemory('Mr. Kurosaki...','מר קורוסאקי...',[e]),'מר קורוסאקי...');
 assert.equal(enforceMemory('Mr. Kurosaki...','קורוסאקי...',[e]),'מר קורוסאקי...');
 assert.equal(enforceMemory('Kurosaki...','קורוסאקי...',[e]),'קורוסאקי...');
 assert.equal(enforceMemory('Miss Kurosaki...','מיס קורוסאקי...',[e]),'מיס קורוסאקי...');
});
