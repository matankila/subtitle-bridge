import test from 'node:test';
import assert from 'node:assert/strict';
import {providers,translateWithFallback} from '../lib/providers.mjs';
const env={LIBRETRANSLATE_URL:'https://translate.example.org',DEEPL_API_KEY:'test:fx'};
test('LibreTranslate primary uses POST, preserves privacy and skips fallback on success',async()=>{
 let calls=0;const result=await translateWithFallback('Hello','he','private@example.org',async(url,options)=>{calls++;assert.equal(url,'https://translate.example.org/translate');assert.equal(options.redirect,'manual');const b=JSON.parse(options.body);assert.deepEqual(b,{q:'Hello',source:'en',target:'he',format:'text'});return Response.json({translatedText:'שלום'});},'192.0.2.1',env);assert.equal(result,'שלום');assert.equal(calls,1);
});
test('quota, timeout, invalid response, auth and redirects trigger DeepL fallback',async()=>{
 for(const failure of [429,403,302,500,'timeout','invalid']){const seen=[];const result=await translateWithFallback('Hello','he','',async(url,opt)=>{seen.push(url);if(seen.length===1){if(failure==='timeout')throw new Error('timeout');return failure==='invalid'?Response.json({translatedText:''}):new Response(null,{status:failure});}assert.equal(url,'https://api-free.deepl.com/v2/translate');assert.equal(opt.headers.Authorization,'DeepL-Auth-Key test:fx');assert.equal(JSON.parse(opt.body).target_lang,'HE');return Response.json({translations:[{text:'שלום'}]});},'',env);assert.equal(result,'שלום');assert.equal(seen.length,2);}
});
test('no configured provider silently falls back to MyMemory; errors do not leak secrets',async()=>{
 let calls=0;await assert.rejects(translateWithFallback('Hi','he','',async()=>{calls++;throw new Error('secret test:fx');},'',env),e=>!e.message.includes('test:fx'));assert.equal(calls,2);
});
test('DeepL-only setup works and operator monthly cap prevents requests',async()=>{
 assert.equal(providers({DEEPL_API_KEY:'pro-key'})[0].url,'https://api.deepl.com/v2/translate');let calls=0;await assert.rejects(translateWithFallback('Hi','he','',async()=>{calls++;},'',{DEEPL_API_KEY:'pro-key'},async()=>{throw new Error('quota');}));assert.equal(calls,0);
});
test('reject unsafe endpoints before sending credentials',()=>{
 for(const url of ['http://example.org','https://127.0.0.1','https://user:pass@example.org','https://example.org/?key=secret','https://[::1]'])assert.throws(()=>providers({LIBRETRANSLATE_URL:url}));
});
