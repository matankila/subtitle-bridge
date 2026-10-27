import test from 'node:test';
import assert from 'node:assert/strict';
import {searchInput,searchResults} from '../lib/catalog.mjs';
test('search preserves Unicode, normalizes whitespace, rejects invalid input',()=>{
 assert.deepEqual(searchInput({type:'series',query:'  שלום   עולם '}),{type:'series',query:'שלום עולם'});
 for(const body of [null,{}, {type:'series',query:'a'},{type:'series',query:'a'.repeat(101)},{type:'channel',query:'test'},{type:'movie',query:'a\0b'}])assert.throws(()=>searchInput(body));
});
test('catalog matches retain title/year and exclude invalid IDs, other types and duplicates',()=>{
 const show={id:'tt1234567',type:'series',name:'The Office',releaseInfo:'2005-2013'};
 const r=searchResults({metas:[show,show,null,{...show,id:'https://evil.test'},{...show,id:'tt7654321',type:'movie'},{...show,id:'tt2222222',name:''},{...show,id:'tt1111111',releaseInfo:'2001-2003'}]},'series');
 assert.deepEqual(r.results,[{id:show.id,name:'The Office',year:'2005-2013'},{id:'tt1111111',name:'The Office',year:'2001-2003'}]);
 assert.equal(searchResults({metas:Array.from({length:30},(_,i)=>({...show,id:`tt${1000000+i}`}))},'series').results.length,10);
 assert.deepEqual(searchResults({metas:[]},'movie'),{results:[]});assert.throws(()=>searchResults({},'series'));
});
