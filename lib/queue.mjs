export const retryable = item => ['error','paused','skipped','missing'].includes(item.state);
export const terminal = item => ['ready','existing','missing','skipped'].includes(item.state);
export function retryItems(items,ids,now=Date.now()){
 const selected=new Set(ids);
 return items.map(item=>{
  if(!selected.has(item.id)||!retryable(item))return {...item};
  const reuse=item.jobId&&(!item.expires||item.expires>now);
  return {...item,state:reuse?'pending':'queued',jobId:reuse?item.jobId:undefined,progress:reuse?item.progress:0,url:undefined,error:undefined,expires:reuse?item.expires:undefined};
 });
}
// stopMode is checked at episode boundaries and before each translation request.
// "episode" lets the current episode finish; "request" stops before another call.
export async function processQueue(queue,{api,save,stopMode,onlyIds,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 const selected=onlyIds?new Set(onlyIds):null;
 for(const item of queue.items){
  if(stopMode())break;
  if(selected&&!selected.has(item.id))continue;
  if(item.expires&&item.expires<now()){item.state='queued';item.jobId=undefined;item.url=undefined;item.progress=0;}
  if(terminal(item))continue;
  item.error=undefined;
  try{
   if(!item.jobId){
    if(queue.releaseMode==='manual'&&!item.releaseId&&!item.releaseAuto){item.state='awaiting-release';save(queue);return;}
    item.state='checking';save(queue);
    const result=await api('/api/prepare',{key:queue.key,type:'series',id:item.id,...(item.releaseId?{releaseId:item.releaseId}:{}),...(item.filename?{filename:item.filename}:{})});
    item.releaseLabel=result.bridge.release||item.releaseLabel;
    if(['existing','missing'].includes(result.bridge.state)){
     item.state=result.bridge.state;item.progress=100;item.url=result.subtitles?.[0]?.url;item.expires=now()+(item.state==='existing'?15*60000:60*60000);save(queue);continue;
    }
    item.jobId=result.bridge.id;item.state=result.bridge.state;item.progress=result.bridge.progress;item.expires=result.bridge.expires;save(queue);
   }
   while(item.state!=='ready'&&stopMode()!=='request'){
    const job=await api(`/api/jobs/${item.jobId}/step`,{});
    item.state=job.state;item.phase=job.phase;item.progress=job.progress;item.expires=job.expires;save(queue);
    if(job.state==='paused')throw new Error(job.error||'Provider paused translation. Resume later.');
    if(job.busy)await sleep(1500);
   }
   if(item.state==='ready'){item.url=`/files/${item.jobId}.srt`;save(queue);}
  }catch(e){
   // A job may expire between requests. The next retry should discover it again.
   if(e.code==='JOB'){item.jobId=undefined;item.expires=undefined;item.progress=0;}
   item.state='error';item.error=e.message;save(queue);
   throw new Error(`S${item.season} E${item.episode}: ${item.error}`);
  }
 }
}
