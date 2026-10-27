import { googleTranslate } from './google.mjs';
import {readLimited} from './http.mjs';
import { AddonError, plain, translateUnit } from './subtitles.mjs';

// These values come exclusively from operator-managed runtime secrets, never request bodies.
export function providers(env={}) {
  const list=[];
  if(env.GOOGLE_TRANSLATE_ENABLED==='true')list.push({name:'google',url:'https://translate.google.com'});
  if(env.LIBRETRANSLATE_URL) {
    let url; try { url=new URL(env.LIBRETRANSLATE_URL); } catch { throw new AddonError('PROVIDER_CONFIG','Invalid LibreTranslate server address.',503); }
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.port && url.port!=='443' || !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.includes(':'))
      throw new AddonError('PROVIDER_CONFIG','LibreTranslate requires an operator-approved public HTTPS address.',503);
    list.push({name:'libretranslate',url:url.href.replace(/\/$/,'')+'/translate',key:env.LIBRETRANSLATE_API_KEY||''});
  }
  if(env.DEEPL_API_KEY) list.push({name:'deepl',url:env.DEEPL_API_KEY.endsWith(':fx')?'https://api-free.deepl.com/v2/translate':'https://api.deepl.com/v2/translate',key:env.DEEPL_API_KEY});
  // Preserve existing installs until an alternative is provisioned; never silently fall back to MyMemory from a configured chain.
  return list.length?list:[{name:'mymemory'}];
}
export async function translateWithFallback(text,target,email,fetcher,ip,env={},beforeCall=async()=>{}) {
  const chain=providers(env); let last;
  for(const provider of chain) {
    try {
      await beforeCall(provider.name,Array.from(text).length);
      if(provider.name==='google')return await googleTranslate(text,target,fetcher);
      if(provider.name==='mymemory')return await translateUnit(text,target,email,fetcher,ip);
      const headers={'Content-Type':'application/json'};
      const body=provider.name==='libretranslate'?{q:text,source:'en',target,format:'text',...(provider.key?{api_key:provider.key}:{})}:{text:[text],source_lang:'EN',target_lang:({pt:'PT-PT',en:'EN-US',zh:'ZH-HANS'}[target]||target.toUpperCase()),model_type:'quality_optimized'};
      if(provider.name==='deepl')headers.Authorization='DeepL-Auth-Key '+provider.key;
      const response=await fetcher(provider.url,{method:'POST',headers,body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(12000)});
      if(!response.ok) {
        await response.body?.cancel();
        throw new AddonError([429,456].includes(response.status)?'PROVIDER_QUOTA':'TRANSLATOR_UNAVAILABLE',`${provider.name} rejected translation (HTTP ${response.status}).`,503);
      }
      const bodyText=await readLimited(response,50000);
      const result=JSON.parse(bodyText);
      const translated=provider.name==='libretranslate'?result.translatedText:result.translations?.[0]?.text;
      if(typeof translated!=='string'||!plain(translated))throw new Error('invalid');
      return plain(translated);
    } catch(e) {
      last=e instanceof AddonError?e:new AddonError('TRANSLATOR_UNAVAILABLE',`${provider.name} could not complete translation.`,503);
    }
  }
  throw last;
}
