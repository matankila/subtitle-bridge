import test from 'node:test';
import assert from 'node:assert/strict';
import {googleBatch,googleTranslate,selectGoogleBatch} from '../lib/google.mjs';
import {providers} from '../lib/providers.mjs';
function response(text){return new Response(JSON.stringify([['wrb.fr','MkEWBc',JSON.stringify([null,[[[null,null,null,null,null,[[text]]]]]] )]]));}
test('Google batch preserves cue order and Hebrew text',async()=>{const out=await googleBatch(['Hi','Bye'],'he',async(url,opt)=>{assert.ok(url.includes('batchexecute'));assert.equal(opt.redirect,'manual');assert.equal(opt.method,'POST');return response('@@STREMIO_IDX_0@@ שלום\n@@STREMIO_IDX_1@@ להתראות');});assert.deepEqual(out,['שלום','להתראות']);});
test('missing duplicated and reordered markers fail closed',async()=>{for(const value of ['שלום','@@STREMIO_IDX_0@@ שלום','@@STREMIO_IDX_0@@ שלום @@STREMIO_IDX_0@@ שלום','@@STREMIO_IDX_1@@ שלום @@STREMIO_IDX_0@@ שלום'])await assert.rejects(googleBatch(['Hi','Bye'],'he',async()=>response(value)),/markers/);});
test('Google HTML, redirects, quotas and oversized output are rejected',async()=>{for(const res of [new Response('<html>sorry</html>'),new Response(null,{status:302}),new Response(null,{status:429}),new Response('a'.repeat(250001))])await assert.rejects(googleTranslate('Hi','he',async()=>res));});
test('Google is opt-in and first in configured chain',()=>{assert.equal(providers({})[0].name,'mymemory');assert.deepEqual(providers({GOOGLE_TRANSLATE_ENABLED:'true',DEEPL_API_KEY:'test:fx'}).map(p=>p.name),['google','deepl']);});
test('larger batches cap both segment count and text including alignment markers',()=>{
 const short=Array.from({length:60},()=>({text:'hello',translated:null}));assert.equal(selectGoogleBatch(short).length,48);assert.equal(selectGoogleBatch(short,16).length,16);
 const long=Array.from({length:60},()=>({text:'x'.repeat(480),translated:null}));const selected=selectGoogleBatch(long);assert.ok(selected.length<16);assert.ok(selected.map((u,i)=>`@@STREMIO_IDX_${i}@@ ${u.text}\n`).join('').length<=4500);
 short[0].translated='שלום';assert.equal(selectGoogleBatch(short)[0],short[1]);
});
