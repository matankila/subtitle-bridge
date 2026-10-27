import {AddonError} from './errors.mjs';
export async function readLimited(response,limit=1000000){
 if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw new AddonError('TOO_LARGE','Response is too large.',413);}
 const reader=response.body?.getReader();if(!reader)return '';
 let total=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw new AddonError('TOO_LARGE','Response is too large.',413);chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder('utf-8',{fatal:false}).decode(all);
}
// At most four connections, leaving room for database and upstream bookkeeping.
export async function boundedMap(items,fn,concurrency=4){
 const results=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;try{results[i]={status:'fulfilled',value:await fn(items[i],i)};}catch(reason){results[i]={status:'rejected',reason};}}}));
 return results;
}
