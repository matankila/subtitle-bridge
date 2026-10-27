import {AddonError} from './errors.mjs';
import {SERIES_MEMORY_VERSION} from './series-memory.mjs';
import {RELEASE_MATCH_VERSION} from './releases.mjs';
const DAY=86400000;
export function authorizeHistory(request,env){
 if(!request.headers.get('oai-authenticated-user-id'))throw new AddonError('SIGN_IN','Sign in with your instance admin token to view request history.',401);
 const owner=String(env.REQUEST_HISTORY_OWNER_EMAIL||'').trim().toLowerCase();
 if(!owner||request.headers.get('oai-authenticated-user-email')?.toLowerCase()!==owner)throw new AddonError('FORBIDDEN','Request history is available only to the site owner.',403);
}
async function fingerprint(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function trackRequest(db,config,media,origin,run,jobStatus){
 const id=crypto.randomUUID().replaceAll('-',''),now=Date.now();
 const key='request-flight:'+await fingerprint([RELEASE_MATCH_VERSION,SERIES_MEMORY_VERSION,origin,media.type,media.id,Object.fromEntries(Object.entries(media.extra).sort(([a],[b])=>a.localeCompare(b))),config.target,config.releaseId||null,config.providerVersion||null,config.refinementVersion||null,config.refinementModel||null,Boolean(config.contextEnabled),config.alternative?'shared':config.email||'',config.alternative?'shared':config.ip||'']);
 const claim=await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires WHERE lookups.expires<=? RETURNING data').bind(key,JSON.stringify({requestId:id}),now+90000,now).first();
 if(!claim){
  const deadline=Date.now()+20000;
  do{
   const cached=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind(key,Date.now()).first();const saved=cached?JSON.parse(cached.data):null;
   if(saved?.response||saved?.error){
    await db.prepare('UPDATE subtitle_requests SET hits=hits+1,last_seen=? WHERE id=?').bind(Date.now(),saved.requestId).run();
    if(saved.error)throw new AddonError(saved.error.code,saved.error.message,saved.error.status);
    let result=saved.response;
    const jobId=result.bridge?.id||result.subtitles?.map(s=>String(s.id).match(/^bridge-machine-([a-f0-9]{32})$/)?.[1]).find(Boolean);
    if(jobId&&jobStatus){const row=await db.prepare('SELECT * FROM jobs WHERE id=? AND expires>?').bind(jobId,Date.now()).first();if(!row){await db.prepare('UPDATE lookups SET expires=0 WHERE id=?').bind(key).run();return trackRequest(db,config,media,origin,run,jobStatus);}result={...result,bridge:{...result.bridge,...jobStatus(row)}};}
    return {...result,bridge:{...result.bridge,requestId:saved.requestId,deduplicated:true}};
   }
   if(!saved)return trackRequest(db,config,media,origin,run,jobStatus);
   await new Promise(resolve=>setTimeout(resolve,500));
  }while(Date.now()<deadline);
  throw new AddonError('DISCOVERING','This subtitle request is already being discovered. Retry shortly; no duplicate translation was started.',503);
 }
 await db.prepare('INSERT INTO subtitle_requests(id,created,updated,media_type,media_id,target,origin,filename,state,expires) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,now,now,media.type,media.id,config.target,origin,String(media.extra.filename||'').slice(0,500),'discovering',now+30*DAY).run();
 try{
  const result=await run(),bridge=result.bridge||{};
  const cachedId=result.subtitles?.map(s=>String(s.id).match(/^bridge-machine-([a-f0-9]{32})$/)?.[1]).find(Boolean);
  const jobId=/^[a-f0-9]{32}$/.test(bridge.id||'')?bridge.id:cachedId||null;
  const prepared=result.subtitles?.some(s=>String(s.id).startsWith('bridge-machine-'));
  const state=bridge.state==='existing'&&prepared?'ready':bridge.state||'unknown';
  await db.prepare('UPDATE subtitle_requests SET updated=?,state=?,job_id=?,release=?,message=?,duration_ms=? WHERE id=?').bind(Date.now(),state,jobId,String(bridge.release||'').slice(0,700),bridge.message||null,Date.now()-now,id).run();
  let canonical=id;
  // Different Stremio extra-parameter shapes only merge after the source cues
  // have resolved to the same job. Never guess that different releases match.
  if(jobId){const previous=await db.prepare('SELECT id FROM subtitle_requests WHERE job_id=? AND media_id=? AND target=? AND origin=? AND filename=? AND release=? AND duplicate_of IS NULL AND created>? AND (created<? OR (created=? AND id<?)) ORDER BY created,id LIMIT 1').bind(jobId,media.id,config.target,origin,String(media.extra.filename||'').slice(0,500),String(bridge.release||'').slice(0,700),now-300000,now,now,id).first();if(previous){canonical=previous.id;await db.prepare('UPDATE subtitle_requests SET hits=hits+1,last_seen=? WHERE id=?').bind(Date.now(),canonical).run();await db.prepare('UPDATE subtitle_requests SET duplicate_of=? WHERE id=?').bind(canonical,id).run();}}
  const response={...result,bridge:{...bridge,requestId:canonical,...(canonical!==id?{deduplicated:true}:{})}};
  await db.prepare('UPDATE lookups SET data=?,expires=? WHERE id=?').bind(JSON.stringify({requestId:canonical,response}),Date.now()+300000,key).run();
  return response;
 }catch(error){
  await db.prepare('UPDATE subtitle_requests SET updated=?,state=?,error_code=?,message=?,duration_ms=? WHERE id=?').bind(Date.now(),'error',error.code||'UNAVAILABLE',error instanceof AddonError?error.message:'The subtitle request could not complete.',Date.now()-now,id).run();
  await db.prepare('UPDATE lookups SET data=?,expires=? WHERE id=?').bind(JSON.stringify({requestId:id,error:{code:error.code||'UNAVAILABLE',message:error instanceof AddonError?error.message:'The subtitle request could not complete.',status:error.status||503}}),Date.now()+5000,key).run();
  throw error;
 }
}
export async function listRequests(db,url,jobStatus){
 const limit=25,filter=url.searchParams.get('filter')||'all',cursor=url.searchParams.get('cursor');
 if(!['all','live','attention'].includes(filter))throw new AddonError('FILTER','Unknown request filter.',400);
 let before=Number.MAX_SAFE_INTEGER,beforeId='~';
 if(cursor){const match=cursor.match(/^(\d{1,16}):([a-f0-9]{32})$/);if(!match)throw new AddonError('CURSOR','Invalid history cursor.',400);before=Number(match[1]);beforeId=match[2];}
 const condition=filter==='live'?"AND (COALESCE(j.state,r.state) IN ('pending','processing') OR r.state='discovering')":filter==='attention'?"AND COALESCE(j.state,r.state) IN ('paused','error','missing')":'';
 const row=await db.prepare(`SELECT json_group_array(json_object('id',id,'created',created,'updated',updated,'mediaType',media_type,'mediaId',media_id,'target',target,'origin',origin,'filename',filename,'release',release,'state',state,'jobId',job_id,'errorCode',error_code,'message',message,'lookupMs',duration_ms,'hits',hits,'lastSeen',last_seen,'jobData',job_data,'jobState',job_state,'jobError',job_error,'jobExpires',job_expires,'leaseUntil',lease_until)) AS data FROM (SELECT r.*,j.data AS job_data,j.state AS job_state,j.error AS job_error,j.expires AS job_expires,j.lease_until FROM subtitle_requests r LEFT JOIN jobs j ON j.id=r.job_id AND j.expires>? WHERE r.expires>? AND r.duplicate_of IS NULL AND (r.created<? OR (r.created=? AND r.id<?)) ${condition} ORDER BY r.created DESC,r.id DESC LIMIT ?)`)
  .bind(Date.now(),Date.now(),before,before,beforeId,limit+1).first();
 const rows=JSON.parse(row?.data||'[]'),more=rows.length>limit,items=rows.slice(0,limit).map(r=>{
  const {jobData,jobState,jobError,jobExpires,leaseUntil,...item}=r;
  if(jobData){const job=jobStatus({id:r.jobId,data:jobData,state:jobState,error:jobError,expires:jobExpires});return {...item,state:job.state,progress:job.progress,phase:job.phase,seriesContext:job.seriesContext,completed:job.completed,total:job.total,cues:job.cues,refinement:job.refinement,timings:job.timings,retryAt:job.retryAt,error:job.error,running:leaseUntil>Date.now(),download:job.state==='ready'?`/files/${r.jobId}.srt`:null};}
  return {...item,state:r.jobId?'expired':r.state,running:r.state==='discovering'&&r.updated>Date.now()-120000};
 });
 const legacy=await db.prepare("SELECT json_group_array(json_object('id',id,'created',created,'state',state,'target',target,'error',error,'expires',expires)) AS data FROM (SELECT j.id,j.created,j.state,j.target,j.error,j.expires FROM jobs j WHERE NOT EXISTS(SELECT 1 FROM subtitle_requests r WHERE r.job_id=j.id) AND j.expires>? ORDER BY j.created DESC LIMIT 25)").bind(Date.now()).first();
 const last=items.at(-1);
 return {items,nextCursor:more&&last?`${last.created}:${last.id}`:null,legacyJobs:cursor||filter!=='all'?[]:JSON.parse(legacy?.data||'[]'),retentionDays:30,asOf:Date.now()};
}
