import test from 'node:test';
import assert from 'node:assert/strict';
import {episodeList} from '../lib/episodes.mjs';
const v=(season,episode,released='2020-01-01')=>({season,episode,released,name:'Episode title'});
test('episode discovery sorts, deduplicates, retains specials, excludes future and unknown dates',()=>{
 const r=episodeList({name:'Show',videos:[v(2,2),v(1,2),v(0,1),v(1,1),v(1,1),v(1,3,'2099-01-01'),v(1,4,''),v(-1,1),v(1,0)]},'tt1234567');
 assert.deepEqual(r.episodes.map(e=>e.id),['tt1234567:0:1','tt1234567:1:1','tt1234567:1:2','tt1234567:2:2']);assert.equal(r.episodes[0].title,'Episode title');
});
test('missing series videos and oversized lists are explicit errors',()=>{assert.throws(()=>episodeList({},'tt1234567'));assert.throws(()=>episodeList({videos:Array.from({length:2001},(_,i)=>v(1,i+1))},'tt1234567'));});
