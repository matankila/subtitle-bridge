import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverTracks} from '../lib/subtitle-sources.mjs';
const media={type:'series',id:'tt9054364:4:4',extra:{filename:'Slime.S04E04.mkv'}};
const track={id:'1',lang:'eng',movieReleaseName:'Slime.S04E04',url:'https://subs5.strem.io/subtitle'};
test('providers are merged, duplicate URLs removed, metadata and release hints retained',async()=>{
 const calls=[];const result=await discoverTracks(media,'he',true,async(url,options)=>{calls.push(String(url));assert.equal(options.redirect,'manual');assert.match(String(url),/filename=Slime.S04E04.mkv/);return Response.json({subtitles:[track]});});assert.equal(calls.length,2);assert.equal(result.length,1);assert.equal(result[0].title,'Slime.S04E04');assert.equal(result[0].provider,'OpenSubtitles v3');
});
test('one failed provider can use a healthy English source but cannot confirm absence',async()=>{
 const result=await discoverTracks(media,'he',false,async url=>String(url).includes('opensubtitles-v3')?Response.json({subtitles:[track]}):new Response(null,{status:503}));assert.equal(result.length,1);
 await assert.rejects(discoverTracks(media,'he',false,async url=>String(url).includes('opensubtitles-v3')?Response.json({subtitles:[]}):new Response(null,{status:503})),e=>e.code==='SOURCE_UNAVAILABLE');
 assert.deepEqual(await discoverTracks(media,'he',false,async()=>Response.json({subtitles:[]})),[]);
});
