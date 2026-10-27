export async function clientApi(path,body){
 let response;
 try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(330000)});}
 catch(e){throw Object.assign(new Error(e?.name==='TimeoutError'?'Request timed out. Your saved translation can be resumed.':'Connection interrupted. Check your connection and resume.'),{code:'NETWORK'});}
 let value;try{value=await response.json();}catch{throw Object.assign(new Error('The server returned an invalid response. Your saved progress is retained.'),{code:'RESPONSE'});}
 if(!response.ok)throw Object.assign(new Error(value?.message||'Service unavailable. Resume later.'),{code:value?.error,status:response.status,retryAfter:Number(response.headers.get('Retry-After'))||null});
 return value;
}
export async function withQueueLock(action,locks=globalThis.navigator?.locks){
 if(!locks)return action();
 return locks.request('subtitle-bridge-series-queue',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('This queue is running in another tab. Pause it there before changing or starting it here.');
  return action();
 });
}
