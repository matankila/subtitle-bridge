import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handle,manifest,reserve,safeDownload,PUBLIC_ORIGIN} from '../lib/addon.mjs';
import {parseSubtitles,makeWork,renderSrt,splitUtf8,language,translateUnit,selectTracks} from '../lib/subtitles.mjs';
const SRT='1\r\n00:00:01,200 --> 00:00:03,500\r\n<i>Hello</i> &amp; welcome!\r\n\r\n2\r\n00:00:04,010 --> 00:00:06,900\r\nHello again.\r\n';
test('standard OpenSubtitles source fixes Slime discovery when v3+ is empty',async()=>{
 const db=database(),hosts=[];const english={id:'13719140',lang:'eng',subtitleFileName:'Slime.S04E04.en.srt',movieReleaseName:'Slime.S04E04',url:'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1962286227'};
 const fetcher=async(url,options)=>{const u=new URL(url);hosts.push(u.hostname);assert.equal(options.redirect,'manual');if(u.hostname==='opensubtitles.stremio.homes')return Response.json({subtitles:[]});if(u.hostname==='opensubtitles-v3.strem.io')return Response.json({subtitles:[english]});if(u.hostname==='subs5.strem.io')return new Response(SRT);if(u.hostname==='api.mymemory.translated.net')return Response.json({responseStatus:200,responseData:{translatedText:'שלום'}});throw Error('unexpected provider');};
 const body={key:'he',type:'series',id:'tt9054364:4:4'};const releases=await (await handle(request('/api/releases',body),db,fetcher)).json();assert.equal(releases.options.length,1);assert.equal(releases.options[0].label,'Slime.S04E04');const prepared=await (await handle(request('/api/prepare',body),db,fetcher)).json();assert.equal(prepared.bridge.state,'pending');assert.ok(hosts.includes('subs5.strem.io'));await handle(request(`/api/jobs/${prepared.bridge.id}/step`,{}),db,fetcher);const file=await handle(new Request(prepared.subtitles[0].url),db,fetcher);assert.equal(file.status,200);assert.deepEqual(parseSubtitles(await file.text()).map(c=>[c.start,c.end]),[[1200,3500],[4010,6900]]);
});
test('standard subtitle host is allowed without allowing spoofed hosts or private redirects',async()=>{
 assert.equal(await safeDownload('https://subs5.strem.io/test',async()=>new Response(SRT)),SRT);
 for(const url of ['https://subs5.strem.io.evil.test/x','https://subs999.strem.io/x','https://127.0.0.1/x'])await assert.rejects(safeDownload(url,async()=>{throw Error('must not fetch');}),e=>e.code==='SOURCE_HOST');
 await assert.rejects(safeDownload('https://subs5.strem.io/test',async()=>new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest'}})),e=>e.code==='SOURCE_HOST');
});
function database(){const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};}};},async batch(statements){return Promise.all(statements.map(x=>x.run()));}};}
function request(path,data,method=data===undefined?'GET':'POST'){return new Request(PUBLIC_ORIGIN+path,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});}
function upstream({native=false,missing=false,fail=false,translateFail=false}={}){let translations=0,downloads=0,lookups=0;const fetcher=async(url,init)=>{const u=new URL(url);if(u.hostname==='api.mymemory.translated.net'){translations++;return Response.json(translateFail?{responseStatus:429,quotaFinished:true}:{responseStatus:200,responseData:{translatedText:'שלום '+u.searchParams.get('q')},quotaFinished:false});}if(u.pathname.includes('/subtitles/')){lookups++;if(fail)return new Response('bad',{status:503});return Response.json({subtitles:missing?[]:[{id:'en',lang:'eng',url:'https://opensubtitles.stremio.homes/sub.vtt/?id=1'},...(native?[{id:'he',lang:'heb',url:'https://opensubtitles.stremio.homes/sub.vtt/?id=2'}]:[])]});}downloads++;return new Response(SRT);};return {fetcher,counts:()=>({translations,downloads,lookups})};}
test('release selection binds exact source, preserves its timings, and exposes prepared choices to TV',async()=>{
 const db=database(),downloads=[];const tracks=[{id:'web',title:'Film.1080p.WEB-DL.GroupA',lang:'eng',url:'https://opensubtitles.stremio.homes/sub.vtt/?id=web'},{id:'bluray',title:'Film.2160p.BluRay.GroupB',lang:'eng',url:'https://opensubtitles.stremio.homes/sub.vtt/?id=bluray'},{id:'heb',title:'Film.720p.WEB-DL.Other',lang:'heb',url:'https://opensubtitles.stremio.homes/sub.vtt/?id=heb'}];
 const fetcher=async(url)=>{const u=new URL(url);if(u.pathname.includes('/subtitles/'))return Response.json({subtitles:tracks});if(u.hostname==='api.mymemory.translated.net')return Response.json({responseStatus:200,responseData:{translatedText:'שלום'}});downloads.push(u.searchParams.get('id'));return new Response(u.searchParams.get('id')==='bluray'?SRT.replace('00:00:01,200','00:00:02,200'):SRT);};
 const data={key:'he',type:'movie',id:'tt0133093'};
 const listing=await (await handle(request('/api/releases',data),db,fetcher)).json();assert.equal(listing.options.length,3);assert.ok(listing.options.every(x=>!x.url));const choice=listing.options.find(x=>x.label.includes('BluRay'));
 const result=await (await handle(request('/api/prepare',{...data,releaseId:choice.id}),db,fetcher)).json();assert.equal(result.bridge.state,'pending');assert.deepEqual(downloads,['bluray']);assert.match(result.bridge.release,/BluRay/);
 await handle(request(`/api/jobs/${result.bridge.id}/step`,{}),db,fetcher);
 const srt=await handle(new Request(result.subtitles[0].url),db,fetcher);assert.equal(parseSubtitles(await srt.text())[0].start,2200);
 const tv=await (await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,fetcher)).json();assert.ok(tv.subtitles.some(x=>x.title?.includes('Translated · Film.2160p.BluRay')));
 const forged=await handle(request('/api/prepare',{...data,releaseId:'a'.repeat(64)}),db,fetcher);assert.equal(forged.status,409);assert.deepEqual(downloads,['bluray']);
});
test('SRT and VTT parsing preserve times and remove formatting',()=>{const cues=parseSubtitles(SRT);assert.equal(cues[0].start,1200);assert.equal(cues[1].end,6900);assert.equal(cues[0].text,'Hello & welcome!');const vtt=parseSubtitles('WEBVTT\n\nNOTE a comment\nignored\n\ncue-1\n00:01.000 --> 00:03.000 align:start\n<v Alice>Hi</v>\n');assert.equal(vtt[0].text,'Hi');assert.equal(vtt[0].start,1000);});
test('corrupt timing, empty data and broken UTF-8 are rejected',()=>{for(const s of ['<html>error</html>','1\n00:00:03,000 --> 00:00:01,000\nno','\uFFFD'])assert.throws(()=>parseSubtitles(s));});
test('UTF-8 segments respect API byte limit and preserve Unicode',()=>{const text=('😀 שלום 世界 some words ').repeat(80);const parts=splitUtf8(text);assert.ok(parts.length>1);for(const p of parts){assert.ok(Buffer.byteLength(p)<=500);assert.ok(!p.includes('\uFFFD'));}assert.equal(parts.join(' ').replace(/\s/g,''),text.replace(/\s/g,''));});
test('deduplication and complete-only output preserve all timestamps',()=>{const cues=parseSubtitles(SRT),data=makeWork([...cues,cues[0]]);assert.equal(data.units.length,2);assert.throws(()=>renderSrt(data));data.units.forEach(u=>u.translated='שלום');const out=parseSubtitles(renderSrt(data));assert.equal(out.length,3);assert.deepEqual(out.map(x=>[x.start,x.end]),[...cues,cues[0]].map(x=>[x.start,x.end]));});
test('language normalization and release ranking',()=>{assert.equal(language('iw'),'he');assert.equal(language('fra'),'fr');assert.equal(language('heb'),'he');assert.equal(language('not-a-language'),null);const s=selectTracks([{url:'https://a.test',lang:'eng',id:'webdl'},{url:'https://b.test',lang:'eng',moviehash:'abc',id:'other'}],'he',{videoHash:'abc'});assert.equal(s.sources[0].id,'other');});
test('provider quota, embedded errors and non-200 responses are never subtitles',async()=>{for(const body of [{quotaFinished:true,responseStatus:200},{responseStatus:500,responseData:{translatedText:'bad'}},{responseStatus:200,responseData:{translatedText:'MYMEMORY WARNING'}},{responseStatus:200,responseData:{translatedText:''}}])await assert.rejects(translateUnit('Hi','he','',async()=>Response.json(body)));await assert.rejects(translateUnit('Hi','he','',async()=>new Response('',{status:429})));});
test('download SSRF and redirect destinations are restricted',async()=>{let called=false;await assert.rejects(safeDownload('http://127.0.0.1/secret',async()=>{called=true;}));assert.equal(called,false);await assert.rejects(safeDownload('https://opensubtitles.stremio.homes/sub',async()=>new Response(null,{status:302,headers:{Location:'https://169.254.169.254/latest/meta-data'}})));});
test('existing target track returns immediately without translation or download',async()=>{const db=database(),u=upstream({native:true});const r=await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,u.fetcher);assert.equal(r.status,200);const body=await r.json();assert.equal(body.bridge.state,'existing');assert.equal(body.subtitles[0].lang,'heb');assert.deepEqual(u.counts(),{translations:0,downloads:0,lookups:2});});
test('missing English source returns no subtitles; source outage is not absence',async()=>{for(const opts of [{missing:true},{fail:true}]){const db=database(),u=upstream(opts),r=await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,u.fetcher);const body=await r.json();assert.equal(r.status,opts.fail?503:200);assert.deepEqual(body.subtitles,[]);assert.equal(u.counts().translations,0);}});
test('end-to-end absent-target discovery, translation, caching, and SRT download',async()=>{const db=database(),u=upstream();const fetcher=async(url,init)=>new URL(url).origin===PUBLIC_ORIGIN?handle(new Request(url,init),db,fetcher):u.fetcher(url,init);const r=await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,fetcher);const body=await r.json();assert.equal(body.bridge.state,'pending');assert.equal(u.counts().translations,0);const sub=await handle(new Request(body.subtitles[0].url),db,fetcher);assert.equal(sub.status,200);assert.match(sub.headers.get('Content-Type'),/subrip/);const cues=parseSubtitles(await sub.text());assert.equal(cues.length,2);assert.match(cues[0].text,/שלום/);assert.equal(cues[0].start,1200);assert.equal(u.counts().translations,2);await handle(new Request(body.subtitles[0].url),db,fetcher);assert.equal(u.counts().translations,2);const again=await (await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,fetcher)).json();assert.equal(again.bridge.id,body.bridge.id);assert.equal(u.counts().lookups,2);});
test('HEAD does not start translation',async()=>{const db=database(),u=upstream();const j=await (await handle(request('/api/demo',{key:'he'}),db,u.fetcher)).json();const r=await handle(request(`/files/${j.id}.srt`,undefined,'HEAD'),db,u.fetcher);assert.equal(r.status,503);assert.equal(u.counts().translations,0);});
test('paused provider failures resume without serving partial subtitles',async()=>{const db=database(),bad=upstream({translateFail:true}),good=upstream();const j=await (await handle(request('/api/demo',{key:'he'}),db,bad.fetcher)).json();const paused=await (await handle(request(`/api/jobs/${j.id}/step`,{}),db,bad.fetcher)).json();assert.equal(paused.state,'paused');assert.equal(paused.completed,0);const ready=await (await handle(request(`/api/jobs/${j.id}/step`,{}),db,good.fetcher)).json();assert.equal(ready.state,'ready');});
test('concurrent job processing uses a lease and translates each segment once',async()=>{const db=database(),u=upstream();const j=await (await handle(request('/api/demo',{key:'he'}),db,u.fetcher)).json();const responses=await Promise.all([handle(request(`/api/jobs/${j.id}/step`,{}),db,u.fetcher),handle(request(`/api/jobs/${j.id}/step`,{}),db,u.fetcher)]);const bodies=await Promise.all(responses.map(r=>r.json()));assert.ok(bodies.some(b=>b.busy));assert.equal(u.counts().translations,2);});
test('quota reservation is atomic across competing requests',async()=>{const db=database();const out=await Promise.allSettled([reserve(db,'day',3000,5000,Date.now()+10000),reserve(db,'day',3000,5000,Date.now()+10000)]);assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.sqlite.prepare('SELECT used FROM counters').get().used,3000);});
test('oversized anonymous files are rejected before sending text to provider',async()=>{const db=database();const long=Array.from({length:100},(_,i)=>`${i+1}\n00:00:01,000 --> 00:00:03,000\n${i} ${'word '.repeat(15)}\n`).join('\n');const u=upstream();const fetcher=(url,init)=>new URL(url).pathname.includes('/subtitles/')?u.fetcher(url,init):Promise.resolve(new Response(long));const r=await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,fetcher);assert.equal(r.status,429);assert.equal(u.counts().translations,0);});
test('email needs explicit consent, remains out of manifest, and can be deleted',async()=>{const db=database();let r=await handle(request('/api/config',{target:'he',email:'test@example.com'}),db);assert.equal(r.status,400);r=await handle(request('/api/config',{target:'he',email:'test@example.com',consent:true}),db);const body=await r.json();assert.match(body.key,/^[a-f0-9]{32}$/);const manifestBody=await (await handle(request(`/addon/${body.key}/manifest.json`),db)).text();assert.ok(!manifestBody.includes('test@example.com'));r=await handle(request(`/api/config/${body.key}`,undefined,'DELETE'),db);assert.equal(r.status,200);r=await handle(request(`/addon/${body.key}/manifest.json`),db);assert.equal(r.status,404);});
test('episode IDs, encoded extra params, manifest and CORS',async()=>{const db=database(),u=upstream({native:true});let r=await handle(request('/addon/he/subtitles/series/tt0944947%3A1%3A2/filename=Release%20Name.mkv.json'),db,u.fetcher);assert.equal(r.status,200);r=await handle(request('/addon/he/subtitles/series/tt0944947.json'),db,u.fetcher);assert.equal(r.status,400);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.deepEqual(manifest().resources[0].types,['movie','series']);assert.equal(manifest().behaviorHints.configurationRequired,true);assert.equal(manifest('he').behaviorHints.configurationRequired,false);});
test('expired jobs can be recreated on direct Stremio requests',async()=>{const db=database(),u=upstream();const path='/addon/he/subtitles/movie/tt0133093.json';const first=await (await handle(request(path),db,u.fetcher)).json();db.sqlite.prepare('UPDATE jobs SET expires=1').run();const second=await (await handle(request(path),db,u.fetcher)).json();assert.notEqual(first.bridge.id,second.bridge.id);assert.equal(second.bridge.state,'pending');});
test('resume only retranslates failed units and preserves successful checkpoints',async()=>{const db=database(),u=upstream();const j=await (await handle(request('/api/demo',{key:'he'}),db,u.fetcher)).json();let count=0;const mixed=async(url)=>++count===1?Response.json({responseStatus:200,responseData:{translatedText:'שלום'}}):Response.json({responseStatus:503});const partial=await (await handle(request(`/api/jobs/${j.id}/step`,{}),db,mixed)).json();assert.equal(partial.completed,1);assert.equal(partial.state,'paused');await handle(request(`/api/jobs/${j.id}/step`,{}),db,u.fetcher);assert.equal(u.counts().translations,1);});
test('edge-compatible redirect handling rejects provider redirects without following them',async()=>{let called=0;await assert.rejects(translateUnit('hello','he','',async(url,options)=>{called++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}});}));assert.equal(called,1);const db=database();const r=await handle(request('/addon/he/subtitles/movie/tt0133093.json'),db,async(url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:301});});assert.equal(r.status,503);});
test('MyMemory receives the actual edge-provided IP, never configurable spoofed IP',async()=>{const db=database();const req=new Request(PUBLIC_ORIGIN+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'192.0.2.10','X-Forwarded-For':'198.51.100.99'},body:JSON.stringify({key:'he',ip:'198.51.100.100'})});const j=await (await handle(req,db)).json();let calls=0;await handle(request(`/api/jobs/${j.id}/step`,{}),db,async url=>{calls++;assert.equal(new URL(url).searchParams.get('ip'),'192.0.2.10');return Response.json({responseStatus:200,responseData:{translatedText:'שלום'}});});assert.equal(calls,2);assert.equal(db.sqlite.prepare('SELECT user_ip FROM jobs WHERE id=?').get(j.id).user_ip,'192.0.2.10');});
test('Google job completes using one batch request and charges shared quota',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GOOGLE_RPC_BATCH_ENABLED:'false'};const job=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();let calls=0;
 const fake=async()=>{calls++;const text='@@STREMIO_IDX_0@@ שלום @@STREMIO_IDX_1@@ להתראות';return Response.json([['wrb.fr','MkEWBc',JSON.stringify([null,[[[null,null,null,null,null,[[text]]]]]])]]);};
 const result=await (await handle(request(`/api/jobs/${job.id}/step`,{}),db,fake,env)).json();assert.equal(result.state,'ready');assert.equal(calls,1);assert.ok(db.sqlite.prepare("SELECT used FROM counters WHERE id LIKE 'provider:google:%'").get().used>0);
});
test('failed Google batch uses configured DeepL without retrying Google',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GOOGLE_RPC_BATCH_ENABLED:'false',DEEPL_API_KEY:'test:fx'};const job=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();let google=0,deepl=0;
 const fake=async(url)=>{if(String(url).includes('google')){google++;return new Response(null,{status:429});}deepl++;return Response.json({translations:[{text:'שלום'}]});};
 const result=await (await handle(request(`/api/jobs/${job.id}/step`,{}),db,fake,env)).json();assert.equal(result.state,'ready');assert.equal(google,1);assert.equal(deepl,2);
});
test('series discovery validates IDs, caches upstream metadata and rejects redirects',async()=>{
 const db=database();let calls=0;const fake=async(url,options)=>{calls++;assert.equal(String(url),'https://v3-cinemeta.strem.io/meta/series/tt1234567.json');assert.equal(options.redirect,'manual');return Response.json({meta:{name:'Show',videos:[{season:1,episode:1,released:'2020-01-01',name:'Pilot'}]}});};
 const first=await (await handle(request('/api/episodes',{id:'tt1234567'}),db,fake)).json();assert.equal(first.episodes.length,1);await handle(request('/api/episodes',{id:'tt1234567'}),db,fake);assert.equal(calls,1);assert.equal((await handle(request('/api/episodes',{id:'https://evil.example'}),db,fake)).status,400);
 assert.equal((await handle(request('/api/episodes',{id:'tt7654321'}),db,async()=>new Response(null,{status:302}))).status,503);
});
test('completed translations are reused across phone/TV IPs only for identical source and provider chain',async()=>{
 const db=database(),up=upstream();const path='/addon/he/subtitles/movie/tt1234567.json';
 const from=ip=>new Request(PUBLIC_ORIGIN+path,{headers:{'cf-connecting-ip':ip}});
 const one=await (await handle(from('192.0.2.1'),db,up.fetcher)).json();const two=await (await handle(from('192.0.2.2'),db,up.fetcher)).json();assert.notEqual(one.bridge.id,two.bridge.id);
 await handle(request(`/api/jobs/${one.bridge.id}/step`,{}),db,up.fetcher);
 const tv=await (await handle(from('192.0.2.3'),db,up.fetcher)).json();assert.equal(tv.bridge.id,one.bridge.id);assert.equal(tv.bridge.state,'ready');
 const differentProvider=await (await handle(from('192.0.2.3'),db,up.fetcher,{DEEPL_API_KEY:'test:fx'})).json();assert.notEqual(differentProvider.bridge.id,one.bridge.id);
});
test('title search encodes queries, caches by type, and never accepts redirected upstream results',async()=>{
 const db=database();let calls=0;
 const fake=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(String(url),'https://v3-cinemeta.strem.io/catalog/series/top/search=Law%20%26%20Order.json');return Response.json({metas:[{id:'tt0098844',type:'series',name:'Law & Order',releaseInfo:'1990-'}]});};
 const first=await handle(request('/api/search',{type:'series',query:'Law & Order'}),db,fake);assert.equal(first.status,200);assert.equal((await first.json()).results[0].id,'tt0098844');
 await handle(request('/api/search',{type:'series',query:'law & order'}),db,fake);assert.equal(calls,1);
 assert.equal((await handle(request('/api/search',{type:'movie',query:'Law & Order'}),db,async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}}))).status,503);
 assert.equal((await handle(request('/api/search',{type:'series',query:'x'}),db,fake)).status,400);assert.equal(calls,1);
 assert.equal((await handle(request('/api/search',{type:'series',query:'Other'}),db,async()=>Response.json({wrong:[]}))).status,503);
});
test('shared cache works under D1 LIKE pattern limits and never matches different source cues',async()=>{
 const db=database(),prepare=db.prepare;
 db.prepare=sql=>{const statement=prepare(sql);return {bind(...args){if(/\b(?:LIKE|GLOB)\b/i.test(sql)&&args.some(x=>typeof x==='string'&&x.length>50))throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');return statement.bind(...args);}};};
 const up=upstream(),from=ip=>new Request(PUBLIC_ORIGIN+'/addon/he/subtitles/movie/tt1234567.json',{headers:{'cf-connecting-ip':ip}});
 const first=await (await handle(from('192.0.2.1'),db,up.fetcher)).json();assert.equal(first.bridge.state,'pending');
 await handle(request(`/api/jobs/${first.bridge.id}/step`,{}),db,up.fetcher);
 const shared=await (await handle(from('192.0.2.2'),db,up.fetcher)).json();assert.equal(shared.bridge.id,first.bridge.id);
 db.sqlite.prepare("DELETE FROM lookups WHERE id GLOB 'source:*'").run();
 const different=async(url,options)=>String(url).includes('/subtitles/')?up.fetcher(url,options):new Response(SRT.replace('Hello again.','Another release.'));
 const other=await (await handle(from('192.0.2.3'),db,different)).json();assert.notEqual(other.bridge.id,first.bridge.id);assert.equal(other.bridge.state,'pending');
});
test('large Google alignment failure reduces the saved batch size without committing mismatched cues',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GOOGLE_RPC_BATCH_ENABLED:'false'},up=upstream();
 const srt=Array.from({length:70},(_,i)=>`${i+1}\n00:00:01,000 --> 00:00:03,000\nLine ${i}\n`).join('\n');
 const source=async(url,options)=>String(url).includes('/subtitles/')?up.fetcher(url,options):new Response(srt);
 const result=await (await handle(request('/api/prepare',{key:'he',type:'series',id:'tt14986406:1:9'}),db,source,env)).json();const id=result.bridge.id;
 const rpc=text=>Response.json([['wrb.fr','MkEWBc',JSON.stringify([null,[[[null,null,null,null,null,[[text]]]]]])]]);
 const first=await (await handle(request(`/api/jobs/${id}/step`,{}),db,async()=>rpc('markers lost'),env)).json();assert.equal(first.state,'processing');assert.equal(first.completed,0);
 let data=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(id).data);assert.equal(data.googleBatchSize,16);assert.equal(data.units.filter(u=>u.translated).length,0);
 const second=await (await handle(request(`/api/jobs/${id}/step`,{}),db,async()=>rpc(Array.from({length:16},(_,i)=>`@@STREMIO_IDX_${i}@@ שלום`).join(' ')),env)).json();assert.equal(second.completed,16);assert.equal(second.state,'processing');
});
test('repeated marker failures recover with bounded individual requests and preserve response-to-cue mapping',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GOOGLE_RPC_BATCH_ENABLED:'false'},up=upstream();
 const srt=Array.from({length:24},(_,i)=>`${i+1}\n00:00:${String(i).padStart(2,'0')},000 --> 00:00:${String(i+1).padStart(2,'0')},000\nLine ${i}\n`).join('\n');
 const source=async(url,options)=>String(url).includes('/subtitles/')?up.fetcher(url,options):new Response(srt);
 const result=await (await handle(request('/api/prepare',{key:'he',type:'series',id:'tt14986406:1:10'}),db,source,env)).json();const id=result.bridge.id;
 const rpc=text=>Response.json([['wrb.fr','MkEWBc',JSON.stringify([null,[[[null,null,null,null,null,[[text]]]]]])]]);
 for(const size of [16,1]){
  const failed=await (await handle(request(`/api/jobs/${id}/step`,{}),db,async()=>rpc('Google changed the markers'),env)).json();
  assert.equal(failed.state,'processing');assert.equal(failed.completed,0);assert.equal(JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(id).data).googleBatchSize,size);
 }
 let calls=0;
 const individual=async(url,options)=>{assert.ok(!decodeURIComponent(options.body).includes('STREMIO_IDX'));const index=calls++;await new Promise(r=>setTimeout(r,index%2?0:3));return rpc(`שורה ${index}`);};
 const first=await (await handle(request(`/api/jobs/${id}/step`,{}),db,individual,env)).json();assert.equal(first.completed,4);assert.equal(calls,4);
 for(let i=0;i<5;i++)await handle(request(`/api/jobs/${id}/step`,{}),db,individual,env);
 const output=parseSubtitles(await (await handle(request(`/files/${id}.srt`),db)).text());assert.equal(calls,24);assert.deepEqual(output.map(c=>c.text),Array.from({length:24},(_,i)=>`שורה ${i}`));assert.deepEqual(output.map(c=>[c.start,c.end]),parseSubtitles(srt).map(c=>[c.start,c.end]));
});
test('legacy paused marker errors resume individually and preserve already translated segments',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GOOGLE_RPC_BATCH_ENABLED:'false'};
 const job=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();
 const data=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(job.id).data);data.googleBatchSize=16;data.units[0].translated='כבר תורגם';
 db.sqlite.prepare('UPDATE jobs SET data=?,state=?,error=? WHERE id=?').run(JSON.stringify(data),'paused','Google changed subtitle markers. Translation paused to preserve cue alignment.',job.id);
 let calls=0;const response=await (await handle(request(`/api/jobs/${job.id}/step`,{}),db,async(url,options)=>{calls++;assert.ok(!decodeURIComponent(options.body).includes('STREMIO_IDX'));return Response.json([['wrb.fr','MkEWBc',JSON.stringify([null,[[[null,null,null,null,null,[['שלום']]]]]])]]);},env)).json();
 assert.equal(response.state,'ready');assert.equal(calls,1);assert.equal(JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(job.id).data).units[0].translated,'כבר תורגם');
});
test('individual recovery checkpoints successes and pauses on quotas without automatic retry',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true',GOOGLE_RPC_BATCH_ENABLED:'false'},job=await (await handle(request('/api/demo',{key:'he'}),db,fetch,env)).json();
 const data=JSON.parse(db.sqlite.prepare('SELECT data FROM jobs WHERE id=?').get(job.id).data);data.googleBatchSize=1;db.sqlite.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(data),job.id);
 const rpc=()=>Response.json([['wrb.fr','MkEWBc',JSON.stringify([null,[[[null,null,null,null,null,[['שלום']]]]]])]]);
 let calls=0;const partial=await (await handle(request(`/api/jobs/${job.id}/step`,{}),db,async()=>++calls===1?rpc():new Response(null,{status:429}),env)).json();assert.equal(partial.state,'paused');assert.equal(partial.completed,1);assert.equal(calls,2);
 const cooled=await (await handle(request(`/api/jobs/${job.id}/step`,{}),db,async()=>{calls++;return rpc();},env)).json();assert.equal(cooled.errorCode,'GOOGLE_COOLDOWN');assert.equal(calls,2);db.sqlite.prepare("UPDATE lookups SET expires=1 WHERE id='cooldown:google'").run();
 const resumed=await (await handle(request(`/api/jobs/${job.id}/step`,{}),db,async()=>{calls++;return rpc();},env)).json();assert.equal(resumed.state,'ready');assert.equal(calls,3);
});
test('multilingual evidence flows through preparation, native-language RPC calls, consensus and original cue timings',async()=>{
 const db=database(),env={GOOGLE_TRANSLATE_ENABLED:'true'};let google=0;
 const tracks=['en','fr','es'].map((lang,i)=>({id:lang,lang_code:lang,lang:lang==='en'?'eng':lang==='fr'?'fre':'spa',ai_translated:false,machine_translated:false,uploader_id:i+1,url:`https://opensubtitles.stremio.homes/sub.vtt/?id=${lang}`}));
 const sources={en:'Are you ready?',fr:'Tu es prête ?',es:'¿Estás lista?'};
 const fake=async(url,options)=>{
  const u=new URL(url);if(u.pathname.includes('/subtitles/'))return Response.json({subtitles:tracks});
  if(u.hostname==='opensubtitles.stremio.homes')return new Response(`1\n00:00:01,000 --> 00:00:03,000\n${sources[u.searchParams.get('id')]}\n`);
  google++;const calls=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0];
  return Response.json(calls.map(call=>{const [text,lang]=JSON.parse(call[1])[0],output=lang==='en'?'אתה מוכן?':'את מוכנה?';return ['wrb.fr','MkEWBc',JSON.stringify([[null,null,null,null,null,null,[text]],[[[null,null,null,null,null,[[output]]]]]]),null,null,null,call[3]];}).reverse());
 };
 const prepared=await (await handle(request('/api/prepare',{key:'he',type:'series',id:'tt14986406:1:1'}),db,fake,env)).json();assert.equal(prepared.bridge.context.eligiblePassages,1);
 const id=prepared.bridge.id;let progress=await (await handle(request(`/api/jobs/${id}/step`,{}),db,fake,env)).json();assert.equal(progress.state,'processing',JSON.stringify(progress));
 progress=await (await handle(request(`/api/jobs/${id}/step`,{}),db,fake,env)).json();assert.equal(progress.state,'ready');assert.equal(progress.context.consensusApplied,1);assert.equal(google,2);
 const output=parseSubtitles(await (await handle(request(`/files/${id}.srt`),db,fake,env)).text());assert.equal(output[0].text,'את מוכנה?');assert.equal(output[0].start,1000);assert.equal(output[0].end,3000);
});
