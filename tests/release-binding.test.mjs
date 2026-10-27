import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handle,PUBLIC_ORIGIN} from '../lib/addon.mjs';
import {releaseMatch} from '../lib/releases.mjs';
import {selectTracks,parseSubtitles} from '../lib/subtitles.mjs';
function database(){const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};}};},async batch(s){return Promise.all(s.map(x=>x.run()));}};}
function fixture(native=false){const db=database(),state={translations:0,downloads:[],tracks:[...Array.from({length:3},(_,i)=>({id:'en'+i,lang:'eng',title:'BLEACH TYBW - S04E03',url:'https://subs5.strem.io/'+i})),...(native?[{id:'he',lang:'heb',title:'Other release',url:'https://subs5.strem.io/native'}]:[])]};const fetcher=async(url,options)=>{const u=new URL(url);if(u.host===new URL(PUBLIC_ORIGIN).host)return handle(new Request(url,options),db,fetcher);if(u.pathname.includes('/subtitles/'))return Response.json({subtitles:state.tracks});if(u.hostname==='api.mymemory.translated.net'){state.translations++;return Response.json({responseStatus:200,responseData:{translatedText:'שלום'}});}state.downloads.push(u.pathname);return new Response(`1\n00:00:0${Number(u.pathname.slice(1))+1},000 --> 00:00:0${Number(u.pathname.slice(1))+3},000\nHello.\n`);};const list=async filename=>(await handle(new Request(PUBLIC_ORIGIN+'/addon/he/subtitles/series/tt14986406%3A4%3A3/filename='+encodeURIComponent(filename)+'.json'),db,fetcher)).json();return {db,state,fetcher,list};}
test('common episode words never count as a verified release and hash wins over filename',()=>{
 const extra={filename:'[Judas] Bleach.S01E43.mkv',videoHash:'abcdef0123456789'};const weak={id:'weak',lang:'en',title:'Bleach.S01E43',url:'https://subs5.strem.io/a'},exact={...weak,id:'exact',title:'Different label',moviehash:extra.videoHash},wrong={...weak,id:'wrong',title:extra.filename,moviehash:'1111111111111111'};
 assert.equal(releaseMatch(weak,extra),'unverified');assert.equal(releaseMatch(exact,extra),'hash');assert.equal(releaseMatch(wrong,extra),'mismatch');assert.deepEqual(selectTracks([wrong,weak,exact],'he',extra).sources.map(x=>x.id),['exact','weak','wrong']);
});
test('native Hebrew cannot hide three English releases; each lazy GET keeps exact source timestamps',async()=>{
 const {db,state,fetcher,list}=fixture(true);const result=await list('[Judas] Bleach.S01E43.mkv');const choices=result.subtitles.filter(x=>x.id.startsWith('bridge-release-'));
 assert.equal(choices.length,3);assert.equal(new Set(choices.map(x=>x.id)).size,3);assert.equal(new Set(choices.map(x=>x.url)).size,3);assert.equal(state.translations,0);assert.deepEqual(state.downloads,[]);assert.ok(choices.every(x=>x.title.includes('Timing unverified')));
 assert.ok(choices.every(x=>x.label.includes('Timing unverified')&&x.label.includes('#en')&&x.lang==='heb'));
 for(let i=0;i<3;i++){const head=await handle(new Request(choices[i].url,{method:'HEAD'}),db,fetcher);assert.equal(head.status,200);}assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
 // Providers can reorder or remove the listing after discovery. The selected
 // link remains bound to the server-issued subtitle URL, never the new top hit.
 state.tracks.reverse();
 for(let i=0;i<3;i++){const file=await handle(new Request(choices[i].url),db,fetcher);assert.equal(file.status,200);assert.equal(parseSubtitles(await file.text())[0].start,(i+1)*1000);}
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM jobs').get().n,3);assert.equal(state.translations,3);
 const again=await handle(new Request(choices[1].url),db,fetcher);assert.equal(again.status,200);assert.equal(parseSubtitles(await again.text())[0].start,2000);assert.equal(state.translations,3);
 const after=await list('[Other] Bleach.S01E43.mkv');assert.equal(after.subtitles.filter(x=>x.id.startsWith('bridge-release-')).length,3);
});
test('a completed first source cannot collapse a differently timed second source, even with identical labels',async()=>{
 const {db,state,fetcher,list}=fixture();const first=await list('ReleaseA.mkv');assert.equal(first.bridge.state,'pending');assert.equal(first.subtitles.length,3);await handle(new Request(PUBLIC_ORIGIN+'/api/jobs/'+first.bridge.id+'/step',{method:'POST'}),db,fetcher);
 const second=await list('ReleaseB.mkv');assert.equal(second.subtitles.length,3);const alternative=second.subtitles.find(x=>x.title.includes('#en1'));const file=await handle(new Request(alternative.url),db,fetcher);assert.equal(file.status,200);assert.equal(parseSubtitles(await file.text())[0].start,2000);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM jobs').get().n,2);assert.equal(state.translations,2);
});
test('unknown, expired or forged release links cannot select an arbitrary download URL',async()=>{
 const {db,fetcher,list,state}=fixture(true);const listing=await list('Release.mkv');const choice=listing.subtitles.find(x=>x.id.startsWith('bridge-release-'));
 db.sqlite.prepare("UPDATE lookups SET expires=1 WHERE id LIKE 'translation-link:%'").run();assert.equal((await handle(new Request(choice.url),db,fetcher)).status,404);assert.equal((await handle(new Request(PUBLIC_ORIGIN+'/translations/'+'a'.repeat(64)+'.srt?url=https://evil.test'),db,fetcher)).status,404);assert.equal(state.downloads.length,0);
});
