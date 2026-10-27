import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handle,PUBLIC_ORIGIN} from '../lib/addon.mjs';
function database(){const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};}};},async batch(s){return Promise.all(s.map(x=>x.run()));}};}
const env={REQUEST_HISTORY_OWNER_EMAIL:'owner@example.test'};
function request(path,body,owner=false){return new Request(PUBLIC_ORIGIN+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
const history=async(db,filter='all')=>(await handle(request('/api/requests?filter='+filter,undefined,true),db,fetch,env)).json();
test('overlapping identical Stremio requests share discovery, quota and one history entry',async()=>{
 const db=database();let release,started;const startedPromise=new Promise(r=>started=r),gate=new Promise(r=>release=r);let calls=0;
 const fetcher=async()=>{calls++;started();await gate;return Response.json({subtitles:[]});};
 const path='/addon/he/subtitles/series/tt9054364%3A4%3A4/filename=Slime.S04E04.mkv.json';const first=handle(request(path),db,fetcher,env);await startedPromise;const second=handle(request(path),db,fetcher,env);release();const [a,b]=await Promise.all([first,second].map(async p=>(await p).json()));assert.equal(calls,2);assert.equal(a.bridge.requestId,b.bridge.requestId);assert.equal(b.bridge.deduplicated,true);const rows=await history(db);assert.equal(rows.items.length,1);assert.equal(rows.items[0].hits,2);assert.equal(db.sqlite.prepare("SELECT used FROM counters WHERE id LIKE 'rate:lookup:%'").get().used,1);
});
test('filename-only and hash-enriched requests group only after resolving to the same source job',async()=>{
 const db=database();const source='1\n00:00:01,000 --> 00:00:03,000\nHello.\n';const fetcher=async url=>new URL(url).pathname.includes('/subtitles/')?Response.json({subtitles:[{id:'source',lang:'eng',title:'Release',url:'https://subs5.strem.io/file'}]}):new Response(source);
 const prefix='/addon/he/subtitles/series/tt14986406%3A4%3A2/filename=Bleach.S04E02.mkv';const a=await (await handle(request(prefix+'.json'),db,fetcher,env)).json();const b=await (await handle(request(prefix+'&videoHash=0123456789abcdef&videoSize=1000.json'),db,fetcher,env)).json();assert.equal(a.bridge.id,b.bridge.id);assert.equal(a.bridge.requestId,b.bridge.requestId);const data=await history(db);assert.equal(data.items.length,1);assert.equal(data.items[0].hits,2);
});
test('different video hashes that resolve to different source cues never merge',async()=>{
 const db=database();const fetcher=async url=>{const u=new URL(url);if(u.pathname.includes('/subtitles/')){const a=String(url).includes('0123456789abcdef');return Response.json({subtitles:[{id:'source',lang:'eng',title:'Release',url:'https://subs5.strem.io/'+(a?'a':'b')}]});}return new Response(`1\n00:00:01,000 --> 00:00:03,000\n${u.pathname==='/a'?'First release.':'Different release.'}\n`);};const prefix='/addon/he/subtitles/series/tt14986406%3A4%3A2/filename=Bleach.mkv&videoHash=';const a=await (await handle(request(prefix+'0123456789abcdef.json'),db,fetcher,env)).json();const b=await (await handle(request(prefix+'fedcba9876543210.json'),db,fetcher,env)).json();assert.notEqual(a.bridge.id,b.bridge.id);assert.equal((await history(db)).items.length,2);
});
test('history requires authenticated owner and returns no-store responses',async()=>{
 const db=database();assert.equal((await handle(request('/api/requests'),db,fetch,env)).status,401);
 const wrong=new Request(PUBLIC_ORIGIN+'/api/requests',{headers:{'oai-authenticated-user-id':'other','oai-authenticated-user-email':'other@example.test'}});assert.equal((await handle(wrong,db,fetch,env)).status,403);
 const r=await handle(request('/api/requests',undefined,true),db,fetch,env);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.deepEqual((await r.json()).items,[]);
});
test('discovery is visible live and empty source lookup is retained as missing',async()=>{
 const db=database();let finish,started;const begin=new Promise(r=>started=r);const waiting=new Promise(r=>finish=r);
 const work=handle(request('/addon/he/subtitles/series/tt9054364%3A4%3A4/filename=Slime.S04E04.1080p.mkv.json'),db,async()=>{started();await waiting;return Response.json({subtitles:[]});},env);await begin;
 const active=await history(db,'live');assert.equal(active.items.length,1);assert.equal(active.items[0].state,'discovering');assert.equal(active.items[0].mediaId,'tt9054364:4:4');assert.equal(active.items[0].origin,'stremio');assert.equal(active.items[0].filename,'Slime.S04E04.1080p.mkv');
 finish();const result=await (await work).json();assert.ok(result.bridge.requestId);const done=await history(db,'attention');assert.equal(done.items[0].state,'missing');assert.match(done.items[0].message,/No existing/);assert.equal((await history(db,'live')).items.length,0);
});
test('source failures are recorded even though no job was created',async()=>{
 const db=database();const r=await handle(request('/api/prepare',{key:'he',type:'movie',id:'tt0133093'}),db,async()=>new Response(null,{status:503}),env);assert.equal(r.status,503);const data=await history(db);assert.equal(data.items[0].state,'error');assert.equal(data.items[0].errorCode,'SOURCE_UNAVAILABLE');assert.equal(data.items[0].jobId,null);assert.equal(data.legacyJobs.length,0);
});
test('history joins live job progress, timings and completion without leaking account data',async()=>{
 const db=database();const fetcher=async url=>{const u=new URL(url);if(u.pathname.includes('/subtitles/'))return Response.json({subtitles:[{id:'source',lang:'eng',title:'Film.WEB-DL.Group',url:'https://opensubtitles.stremio.homes/sub.vtt/?id=1'}]});if(u.hostname==='api.mymemory.translated.net')return Response.json({responseStatus:200,responseData:{translatedText:'שלום'}});return new Response('1\n00:00:01,000 --> 00:00:04,000\nHello.\n');};
 const created=await (await handle(request('/api/prepare',{key:'he',type:'movie',id:'tt0133093'}),db,fetcher,env)).json();let data=await history(db,'live');assert.equal(data.items[0].state,'pending');assert.equal(data.items[0].jobId,created.bridge.id);assert.equal(data.items[0].progress,0);
 await handle(request(`/api/jobs/${created.bridge.id}/step`,{}),db,fetcher,env);data=await history(db);assert.equal(data.items[0].state,'ready');assert.equal(data.items[0].progress,100);assert.ok(data.items[0].timings);assert.equal(data.items[0].download,`/files/${created.bridge.id}.srt`);assert.equal(data.legacyJobs.length,0);assert.equal((await history(db,'live')).items.length,0);
 const json=JSON.stringify(data);for(const forbidden of ['jobData','user_ip','email','cache_key','Hello.','owner@example.test'])assert.ok(!json.includes(forbidden));
 db.sqlite.prepare('UPDATE jobs SET expires=1').run();assert.equal((await history(db)).items[0].state,'expired');
});
test('history cursor pagination is stable for same-time requests and validates cursors',async()=>{
 const db=database(),now=Date.now();for(let i=0;i<27;i++)db.sqlite.prepare('INSERT INTO subtitle_requests(id,created,updated,media_type,media_id,target,origin,filename,state,expires) VALUES(?,?,?,?,?,?,?,?,?,?)').run(i.toString(16).padStart(32,'0'),now,now,'movie','tt0133093','he','setup','','missing',now+100000);
 const first=await history(db);assert.equal(first.items.length,25);assert.ok(first.nextCursor);const second=await (await handle(request('/api/requests?cursor='+first.nextCursor,undefined,true),db,fetch,env)).json();assert.equal(second.items.length,2);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,27);assert.equal((await handle(request('/api/requests?cursor=invalid',undefined,true),db,fetch,env)).status,400);
});
test('shared providers coalesce across changing IPs and reuse pending jobs across request shapes',async()=>{
 const db=database(),sharedEnv={...env,GOOGLE_TRANSLATE_ENABLED:'true'};
 const source='1\n00:00:01,000 --> 00:00:03,000\nHello.\n';let lookups=0;
 const fetcher=async url=>{if(new URL(url).pathname.includes('/subtitles/')){lookups++;return Response.json({subtitles:[{id:'en',lang:'eng',title:'Release',url:'https://subs5.strem.io/file'}]});}return new Response(source);};
 const path='/addon/he/subtitles/series/tt14986406%3A4%3A2/filename=Bleach.mkv';
 const req=(suffix,ip)=>new Request(PUBLIC_ORIGIN+path+suffix,{headers:{'cf-connecting-ip':ip}});
 const a=await(await handle(req('.json','198.51.100.1'),db,fetcher,sharedEnv)).json();
 const b=await(await handle(req('.json','198.51.100.2'),db,fetcher,sharedEnv)).json();
 assert.equal(a.bridge.requestId,b.bridge.requestId);assert.equal(a.bridge.id,b.bridge.id);assert.equal(lookups,2);
 const c=await(await handle(req('&videoHash=0123456789abcdef.json','198.51.100.3'),db,fetcher,sharedEnv)).json();
 assert.equal(a.bridge.id,c.bridge.id);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
});
