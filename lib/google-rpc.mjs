import {AddonError} from './errors.mjs';
import {plain} from './subtitles.mjs';
import {readLimited} from './http.mjs';
import {buildTranslateUrl} from './vendor/google-core.mjs';

export function rpcBody(texts,target,languages=[]){
 return new URLSearchParams({'f.req':JSON.stringify([texts.map((text,i)=>['MkEWBc',JSON.stringify([[text,languages[i]||'en',target,1],[]]),null,String(i+1)])])}).toString();
}
export function rpcResults(raw,texts){
 const cleaned=raw.replace(/^\)\]\}'\s*/,'');let rows;
 try{rows=JSON.parse(cleaned);}catch{
  // Some batchexecute responses use newline-delimited JSON frames with length lines.
  rows=[];for(const line of cleaned.split('\n'))if(line.trim().startsWith('[')){try{rows.push(...JSON.parse(line));}catch{throw new AddonError('GOOGLE_RPC_SHAPE','Google returned an invalid response frame.');}}
 }
 if(!Array.isArray(rows)||!rows.length)throw new AddonError('GOOGLE_RPC_SHAPE','Google did not return indexed translations.');
 const out=new Array(texts.length).fill(null),seen=new Set();
 for(const row of rows){
  if(!Array.isArray(row)||row[0]!=='wrb.fr')continue;
  const id=String(row[6]);if(row[1]!=='MkEWBc'||!/^\d+$/.test(id))throw new AddonError('GOOGLE_RPC_SHAPE','Google returned an unexpected translation ID.');
  const i=Number(id)-1;if(i<0||i>=texts.length||seen.has(i))throw new AddonError('GOOGLE_RPC_SHAPE','Google returned duplicate or unknown translation IDs.');seen.add(i);
  if(typeof row[2]!=='string')continue;
  let data;try{data=JSON.parse(row[2]);}catch{continue;}
  // Verify both the RPC tag and Google's echoed source, never response order.
  if(data?.[0]?.[6]?.[0]!==texts[i])throw new AddonError('GOOGLE_RPC_SHAPE','Google returned a different source segment.');
  const parts=data?.[1]?.[0]?.[0]?.[5];
  if(Array.isArray(parts)&&parts.length&&parts.every(p=>typeof p?.[0]==='string')){
   const text=plain(parts.map(p=>p[0]).join(' '));if(text)out[i]=text;
  }
 }
 return out;
}
export async function googleRpcBatch(texts,target,fetcher=fetch,languages=[]){
 let response;
 try{response=await fetcher(buildTranslateUrl(),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:rpcBody(texts,target,languages),redirect:'manual',signal:AbortSignal.timeout(20000)});}
 catch{throw new AddonError('GOOGLE_UNAVAILABLE','Google did not respond. Retry after the cooldown.',503);}
 if(!response.ok){await response.body?.cancel();const e=new AddonError(response.status===429?'GOOGLE_QUOTA':'GOOGLE_UNAVAILABLE',`Google translation unavailable (HTTP ${response.status}). Retry later.`,503);e.retryAfter=Math.min(300,Math.max(30,Number(response.headers.get('Retry-After'))||60));throw e;}
 return rpcResults(await readLimited(response,1000000),texts);
}
