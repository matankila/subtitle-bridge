import {POLISH_VERSION,profileFor,prepareEnglish,polishHebrew} from './hebrew.mjs';
import {readabilityStats} from './readability.mjs';
import {REFINEMENT_VERSION,commitRefinement,refineItems,refinementBatch} from './refinement.mjs';
import {SERIES_MEMORY_VERSION,curateStep,enforceMemory,memorySlice,readMemory,memoryKey} from './series-memory.mjs';
import {CONTEXT_VERSION,referenceTracks,attachReferences,translationRequests,applyResponses} from './context.mjs';
import {makeQualityWork,resolveQuality} from './quality.mjs';
import {readLimited,boundedMap} from './http.mjs';
export {readLimited};
import {googleRpcBatch} from './google-rpc.mjs';
import {episodeList} from './episodes.mjs';
import {searchInput,searchResults} from './catalog.mjs';
import {RELEASE_MATCH_VERSION,releaseOptions,releaseLabel,sourceLabel,releaseMatch,matchLabel} from './releases.mjs';
import {authorizeHistory,trackRequest,listRequests} from './request-history.mjs';
import {discoverTracks} from './subtitle-sources.mjs';
import {googleBatch,googleTranslate,selectGoogleBatch} from './google.mjs';
import { providers, translateWithFallback } from './providers.mjs';
import { isIP } from 'node:net';
import { AddonError, LANGUAGES, language, parseSubtitles, makeWork, renderSrt, selectTracks, translateUnit } from './subtitles.mjs';
// Test/default local origin. Self-relays use the configured deployment origin.
export const PUBLIC_ORIGIN='http://127.0.0.1:8787';
const DAY=86400000;
const DOWNLOAD_HOSTS=new Set(['opensubtitles.stremio.homes','dl.opensubtitles.org','www.opensubtitles.org','dl.opensubtitles.com','subs5.strem.io']);
const TOKEN=/^[a-f0-9]{32}$/;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, If-None-Match','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const clientIp=request=>{const ip=request.headers.get('cf-connecting-ip')||'';return isIP(ip)?ip:'';};
const token=()=>crypto.randomUUID().replaceAll('-','');
export async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');}
export function manifest(target=null){return {
  id:'community.subtitlebridge.fallback',version:'0.16.0',name:`Subtitle Bridge${target?' · '+LANGUAGES[target][0]:''}`,
  description:'Beta: prefers existing subtitles from OpenSubtitles v3 and v3+, otherwise translates an English track with the configured translation providers. Usage limits apply. First translations may need preparation on the setup page. No audio transcription.',
  logo:PUBLIC_ORIGIN+'/favicon.svg',resources:[{name:'subtitles',types:['movie','series'],idPrefixes:['tt']}],types:['movie','series'],catalogs:[],
  behaviorHints:{configurable:true,configurationRequired:!target},
};}
export async function safeDownload(url,fetcher=fetch){
  for(let i=0;i<4;i++){
    const u=new URL(url);
    if(u.protocol!=='https:' || u.username || u.password || (u.port&&u.port!=='443') || !DOWNLOAD_HOSTS.has(u.hostname))
      throw new AddonError('SOURCE_HOST','The subtitle download host is not supported.');
    let res;
    try{res=await fetcher(u,{redirect:'manual',signal:AbortSignal.timeout(12000)});}
    catch{throw new AddonError('SOURCE_DOWNLOAD','The English subtitle download did not respond. Retry this episode later.',503);}
    if([301,302,303,307,308].includes(res.status)){const next=res.headers.get('Location');await res.body?.cancel();if(!next)break;url=new URL(next,u).href;continue;}
    if(!res.ok){await res.body?.cancel();throw new AddonError('SOURCE_DOWNLOAD','Could not download the source subtitle.');}
    return readLimited(res);
  }
  throw new AddonError('SOURCE_REDIRECT','Too many subtitle redirects.');
}
export async function reserve(db,key,amount,limit,expires){
  if(amount>limit)throw new AddonError('QUOTA','This translation exceeds the available daily character allowance. Add your contact email in setup for the higher free allowance.',429);
  const row=await db.prepare('INSERT INTO counters (id,used,expires) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET used=used+excluded.used WHERE used+excluded.used<=? RETURNING used')
    .bind(key,amount,expires,limit).first();
  if(!row)throw new AddonError('QUOTA','The daily allowance has been reached. Try again tomorrow. The provider may enforce a lower shared-IP limit.',429);
  return row.used;
}
async function rate(db,request,kind,limit){
  const now=Date.now(),day=Math.floor(now/DAY);
  // Only Cloudflare's own connecting-IP header; never trust X-Forwarded-For.
  const ip=request.headers.get('cf-connecting-ip')||'shared';
  await reserve(db,`rate:${kind}:${day}:${await hash(ip)}`,1,limit,(day+2)*DAY);
}
async function cleanup(db){
  const now=Date.now();
  // One bounded cleanup per five-minute window across all workers, not every episode.
  const claimed=await db.prepare('INSERT INTO counters(id,used,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET used=excluded.used,expires=excluded.expires WHERE expires<=? RETURNING id').bind('maintenance:cleanup',0,now+300000,now).first();
  if(!claimed)return;
  await db.batch([
    db.prepare('DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE expires<? AND lease_until<? LIMIT 200)').bind(now,now),
    db.prepare('DELETE FROM lookups WHERE id IN (SELECT id FROM lookups WHERE expires<? LIMIT 200)').bind(now),
    db.prepare('DELETE FROM counters WHERE id IN (SELECT id FROM counters WHERE expires<? LIMIT 200)').bind(now),
    db.prepare('DELETE FROM configs WHERE id IN (SELECT id FROM configs WHERE created<? LIMIT 200)').bind(now-180*DAY),
    db.prepare('DELETE FROM subtitle_requests WHERE id IN (SELECT id FROM subtitle_requests WHERE expires<? LIMIT 200)').bind(now),
  ]);
}
async function configuration(db,key){
  if(LANGUAGES[key])return {target:key,email:''};
  if(!TOKEN.test(key))throw new AddonError('CONFIG','Choose a language on the setup page.',400);
  const row=await db.prepare('SELECT target,email FROM configs WHERE id=? AND created>?').bind(key,Date.now()-180*DAY).first();
  if(!row)throw new AddonError('CONFIG','This configuration expired or was deleted. Create another on the setup page.',404);
  return row;
}
function configureRefinement(config,env){
 if(config.target==='he'&&env.GEMINI_REFINEMENT_ENABLED==='true'&&(env.GEMINI_API_KEY||env.GEMINI_WRAPPER_URL)){config.refinementVersion=REFINEMENT_VERSION;config.refinementModel=env.GEMINI_API_KEY?(env.GEMINI_REFINEMENT_MODEL||'gemini-3.5-flash-lite'):'anonymous-web-wrapper';}
 return config;
}
function media(type,id,rawExtra=''){
  if(!['movie','series'].includes(type)||!/^tt\d{5,12}(?::\d{1,4}:\d{1,4})?$/.test(id))throw new AddonError('MEDIA_ID','Use an IMDb ID, with :season:episode for a series.',400);
  if((type==='series')!==id.includes(':'))throw new AddonError('MEDIA_ID','Series requests need IMDb ID:season:episode.',400);
  if(rawExtra.length>1600)throw new AddonError('EXTRA','Extra parameters are too long.',400);
  const input=new URLSearchParams(rawExtra),extra={};
  for(const k of ['videoHash','videoSize','filename']){const v=input.get(k);if(v&&v.length<500)extra[k]=v;}
  if(extra.videoHash&&!/^[\da-f]{16}$/i.test(extra.videoHash))delete extra.videoHash;
  if(extra.videoSize&&!/^\d{1,16}$/.test(extra.videoSize))delete extra.videoSize;
  return {type,id,extra};
}
async function lookup(db,m,target,fetcher,withReferences=false){
  const key=await hash(JSON.stringify(['sources-v2',m.type,m.id,m.extra,target,withReferences]));
  const cached=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind(key,Date.now()).first();
  if(cached)return JSON.parse(cached.data);
  const tracks=await discoverTracks(m,target,withReferences,fetcher);
  await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(key,JSON.stringify(tracks),Date.now()+(tracks.length?15*60000:60000)).run();
  return tracks;
}
function status(row){
  const data=JSON.parse(row.data),done=data.units.filter(u=>u.translated).length;
  const refining=data.units.every(u=>u.translated)&&data.refinement?.enabled&&!data.refinement.done;
  return {id:row.id,state:row.state,retryAt:data.retryAt||null,completed:done,total:data.units.length,cues:data.cues.length,progress:data.seriesMemory&&!data.seriesMemory.done?Math.round(5*data.seriesMemory.cursor/Math.max(1,data.cues.length)):refining?Math.min(99,90+Math.round(9*(data.refinement.cursor||0)/Math.max(1,data.refinement.total||1))):Math.round((done+data.units.filter(u=>u.baseline&&!u.translated).length/2)*100/data.units.length),readability:data.readability||null,timings:data.timings||null,profile:data.profile||null,seriesContext:data.seriesMemory?{version:data.seriesMemory.version,completed:data.seriesMemory.cursor,total:data.cues.length,entities:data.seriesMemory.entities.length,done:data.seriesMemory.done}:null,phase:data.seriesMemory&&!data.seriesMemory.done?'curating-series':refining?'refining-hebrew':data.units.some(u=>u.baseline&&!u.translated)?'checking-references':'translating',refinement:data.refinement?{version:data.refinement.version,completed:data.refinement.cursor,total:data.refinement.total,changed:data.refinement.changed,issues:data.refinement.issues,failedBatches:data.refinement.failedBatches}:null,context:data.context?{referenceLanguages:data.context.referenceTracks.map(t=>t.language),eligiblePassages:data.context.eligiblePassages,consensusApplied:data.context.consensusApplied,singleReferenceApplied:data.context.singleReferenceApplied||0}:null,error:row.error||null,target:row.target,expires:row.expires};
}
async function getJob(db,id){
  if(!TOKEN.test(id))throw new AddonError('JOB','Invalid translation link.',404);
  const row=await db.prepare('SELECT * FROM jobs WHERE id=? AND expires>?').bind(id,Date.now()).first();
  if(!row)throw new AddonError('JOB','Translation not found or expired. Prepare it again.',404);
  return row;
}
async function createJob(db,cues,config){
  const baseKey=await hash(JSON.stringify([cues,config.target,config.providerVersion||'mymemory-v1','quality-v2',CONTEXT_VERSION,POLISH_VERSION,config.mediaId||null,Boolean(config.contextEnabled),config.refinementVersion||null,config.refinementModel||null]));
  // Completed files contain no account data. Reuse exact cue/language/provider matches across devices.
  // D1 limits LIKE/GLOB pattern length. These index bounds match only this exact
  // 64-character digest followed by ':', without a pattern or a full-table scan.
  const shared=await db.prepare("SELECT * FROM jobs WHERE cache_key>=? AND cache_key<? AND state='ready' AND expires>? ORDER BY expires DESC LIMIT 1").bind(baseKey+':',baseKey+';',Date.now()).first();
  if(shared){
    const saved=JSON.parse(shared.data);
    // Upgrade cached drafts once, retaining every translated cue and timestamp.
    if(config.refinementVersion&&config.mediaId&&!saved.seriesMemory){
      saved.mediaId=config.mediaId;saved.episodeId=config.episodeId||config.mediaId;
      saved.seriesMemory={version:SERIES_MEMORY_VERSION,cursor:0,done:false,entities:[]};
      saved.refinement={...saved.refinement,enabled:true,done:false,cursor:0,total:0};
      const upgraded=await db.prepare("UPDATE jobs SET data=?,state='processing' WHERE id=? AND state='ready' AND lease_until<? RETURNING *").bind(JSON.stringify(saved),shared.id,Date.now()).first();
      return upgraded||getJob(db,shared.id);
    }
    return shared;
  }
  // Site-funded providers share pending work across changing device/proxy IPs.
  // MyMemory keeps its email/IP quota identity isolated.
  const cacheKey=baseKey+':'+await hash(config.alternative?'shared':(config.email||'anonymous')+'|'+(config.ip||'shared'));
  const existing=await db.prepare('SELECT * FROM jobs WHERE cache_key=? AND expires>?').bind(cacheKey,Date.now()).first();
  if(existing)return existing;
  const work=makeQualityWork(cues,makeWork);
  work.profile=profileFor(config.mediaId);work.target=config.target;work.polishVersion=POLISH_VERSION;
  if(config.refinementVersion)work.refinement={enabled:true,version:config.refinementVersion,model:config.refinementModel,cursor:0,total:0,changed:0,issues:0,failedBatches:0,done:false};
  if(config.target==='he')for(const unit of work.units){const prepared=prepareEnglish(unit.text);if(prepared!==unit.text){unit.sourceText=unit.text;unit.text=prepared;}}
  const data=attachReferences(work,config.references||[]);
  if(config.refinementVersion&&config.mediaId){data.mediaId=config.mediaId;data.episodeId=config.episodeId||config.mediaId;data.seriesMemory={version:SERIES_MEMORY_VERSION,cursor:0,done:false,entities:[]};}
  // Full files are admitted only if they fit the nominal daily free tier.
  const chars=data.units.reduce((n,u)=>n+Array.from(u.text).length,0),limit=config.alternative?100000:config.email?50000:5000;
  if(chars>limit)throw new AddonError('FILE_QUOTA',`This track needs ${chars.toLocaleString()} characters. ${config.alternative?'The configured per-track limit is 100,000.':config.email?'The free email tier allows 50,000 per day.':'Anonymous access allows 5,000 per day; add your own contact email on the setup page for up to 50,000.'}`,429);
  const id=token(),now=Date.now();
  await db.prepare('DELETE FROM jobs WHERE cache_key=? AND expires<=? AND lease_until<?').bind(cacheKey,now,now).run();
  // Quota is charged atomically per processing batch, including retries.
  await db.prepare('INSERT OR IGNORE INTO jobs(id,cache_key,target,email,data,state,created,expires,user_ip) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id,cacheKey,config.target,config.email,JSON.stringify(data),'pending',now,now+7*DAY,config.ip||null).run();
  return db.prepare('SELECT * FROM jobs WHERE cache_key=?').bind(cacheKey).first();
}
export async function step(db,id,fetcher=fetch,env={}){
  const alternative=providers(env)[0].name!=='mymemory';
  let row=await getJob(db,id);
  if(row.state==='ready')return status(row);
  const now=Date.now(),lease=token();
  const acquired=await db.prepare("UPDATE jobs SET lease=?,lease_until=? WHERE id=? AND lease_until<? AND expires>? AND state!='ready' RETURNING *").bind(lease,now+(env.GEMINI_WRAPPER_URL&&!env.GEMINI_API_KEY?360000:120000),id,now,now).first();
  if(!acquired){const fresh=await getJob(db,id);return {...status(fresh),busy:fresh.state!=='ready'};}
  row=acquired;
  const data=JSON.parse(row.data);
  const timings=data.timings??={translationMs:0,refinementMs:0,googleRequests:0,geminiRequests:0,steps:0};
  const upstream=fetcher;fetcher=async(url,options)=>{const host=new URL(url).hostname;if(host==='generativelanguage.googleapis.com')timings.geminiRequests++;else if(host==='translate.google.com'||host==='translate.google.co.il')timings.googleRequests++;return upstream(url,options);};
  const translationStarted=Date.now();
  if(data.mediaId&&data.refinement?.enabled&&!data.seriesMemory?.done){
    let contextError=null;
    try{await curateStep(db,data,{env,fetcher});}catch(e){contextError=e?.status===429?'Series glossary paused: Gemini quota reached. Resume after quota resets.':'Series glossary could not complete. Resume to retry the saved checkpoint.';}
    timings.contextMs=(timings.contextMs||0)+Date.now()-translationStarted;timings.steps++;
    const updated=await db.prepare('UPDATE jobs SET data=?,state=?,error=?,lease=NULL,lease_until=0 WHERE id=? AND lease=? RETURNING *').bind(JSON.stringify(data),contextError?'paused':'processing',contextError,id,lease).first();
    await db.prepare('UPDATE subtitle_requests SET updated=?,state=?,error_code=?,message=? WHERE job_id=?').bind(Date.now(),contextError?'paused':'processing',contextError?'SERIES_CONTEXT':null,contextError,id).run();
    return status(updated||await getJob(db,id));
  }
  // Old paused jobs can recover immediately without repeating the failed batch.
  if(row.state==='paused'&&/Google changed subtitle markers|Google returned an empty subtitle cue|Reserved batch marker in source/.test(row.error||''))data.googleBatchSize=1;
  const indexedGoogle=env.GOOGLE_TRANSLATE_ENABLED==='true'&&env.GOOGLE_RPC_BATCH_ENABLED!=='false'&&!data.googleRpcDisabled;
  const individualGoogle=env.GOOGLE_TRANSLATE_ENABLED==='true'&&!indexedGoogle&&data.googleBatchSize===1;
  const pending=env.GOOGLE_TRANSLATE_ENABLED==='true'&&!individualGoogle?selectGoogleBatch(data.units,data.units.some(u=>u.references?.length>1)?16:data.googleBatchSize===16?16:48):data.units.filter(u=>!u.translated).slice(0,individualGoogle?4:8);
  let error=null,skipGoogle=false;
  const cooldownKey='cooldown:google';
  try{
    data.retryAt=null;
    if(env.GOOGLE_TRANSLATE_ENABLED==='true'&&pending.length){const cooldown=await db.prepare('SELECT expires FROM lookups WHERE id=? AND expires>?').bind(cooldownKey,Date.now()).first();if(cooldown){data.retryAt=cooldown.expires;if(env.LIBRETRANSLATE_URL||env.DEEPL_API_KEY){skipGoogle=true;pending.splice(8);}else throw new AddonError('GOOGLE_COOLDOWN','Google Translate is temporarily paused after a timeout or upstream error. Resume in '+Math.ceil((cooldown.expires-Date.now())/1000)+' seconds. Saved translations are retained. This is separate from Gemini API quota.',503);}}
    const rpcRequests=indexedGoogle?translationRequests(pending):[];
    const chars=indexedGoogle?rpcRequests.reduce((sum,r)=>sum+Array.from(r.text).length,0):pending.reduce((sum,u)=>sum+Array.from(u.text).length,0),day=Math.floor(Date.now()/DAY);
    await reserve(db,`translate:${day}:${await hash(alternative?(row.user_ip||'anonymous'):(row.email||row.user_ip||'anonymous'))}`,chars,alternative?500000:row.email?50000:5000,(day+2)*DAY);
    // Google batches cues into one request and validates all markers before committing.
    if(env.GOOGLE_TRANSLATE_ENABLED==='true'&&!skipGoogle&&pending.length){
      const month=new Date().toISOString().slice(0,7);
      const configured=Number(env.TRANSLATION_MONTHLY_CHAR_LIMIT||(env.GOOGLE_TRANSLATE_ENABLED==='true'?5000000:500000));
      const limit=Number.isSafeInteger(configured)&&configured>0?configured:500000;
      await reserve(db,`provider:google:${month}`,chars,limit,Date.now()+62*DAY);
      pending.forEach(u=>u.attempts++);
      try {
        if(indexedGoogle){
          const output=await googleRpcBatch(rpcRequests.map(r=>r.text),row.target,fetcher,rpcRequests.map(r=>r.lang));
          applyResponses(rpcRequests,output,data);
          if(output.some(t=>!t)){data.googleRpcDisabled=true;data.googleBatchSize=1;for(const u of pending){if(u.baseline)u.translated=u.baseline;delete u.references;}pending.length=0;}
        }else if(individualGoogle){
          // Each request owns one segment: response order cannot shift cue timing.
          // Commit successful segments even if one of the other requests fails.
          const results=await boundedMap(pending,async u=>{u.translated=await googleTranslate(u.text,row.target,fetcher);});
          const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
        }else{
          const output=await googleBatch(pending.map(u=>u.text),row.target,fetcher);
          pending.forEach((u,i)=>u.translated=output[i]);
        }
      } catch(e) {
        if(['GOOGLE_UNAVAILABLE','GOOGLE_QUOTA'].includes(e.code)||e.name==='TimeoutError'||e.name==='AbortError'){const until=Date.now()+1000*(e.retryAfter||30);data.retryAt=until;await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET expires=MAX(expires,excluded.expires)').bind(cooldownKey,'{}',until).run();}
        if(e.code==='GOOGLE_RPC_SHAPE'&&indexedGoogle){data.googleRpcDisabled=true;data.googleBatchSize=1;for(const u of pending){if(u.baseline)u.translated=u.baseline;delete u.references;}pending.length=0;}
        else if(e.code==='GOOGLE_ALIGNMENT'&&!individualGoogle){
          // Large batch -> smaller batch -> marker-free individual requests.
          // Only rejected text is retried, and every attempt still uses quota.
          data.googleBatchSize=pending.length>16?16:1;pending.length=0;
        }else if(!env.LIBRETRANSLATE_URL&&!env.DEEPL_API_KEY)throw e;
        // Use only explicitly configured fallback services; no Google retry storm.
      }
    }
    // Bounded calls for non-Google providers; successful cues are never repeated.
    const results=await boundedMap(pending.filter(u=>!u.translated&&!u.baseline).slice(0,8),async u=>{
      u.attempts++;u.translated=await translateWithFallback(u.text,row.target,row.email,fetcher,row.user_ip||'',{...env,GOOGLE_TRANSLATE_ENABLED:'false'},async(name,amount)=>{
        if(name==='mymemory')return;
        const month=new Date().toISOString().slice(0,7);
        const configured=Number(env.TRANSLATION_MONTHLY_CHAR_LIMIT||500000);
        const limit=Number.isSafeInteger(configured)&&configured>0?configured:500000;
        await reserve(db,`provider:${name}:${month}`,amount,limit,Date.now()+62*DAY);
      });
    });
    const failed=results.find(r=>r.status==='rejected');
    if(failed)throw failed.reason;
  }catch(e){error=e instanceof AddonError?e:new AddonError('TRANSLATOR_UNAVAILABLE','Translation paused. Try again shortly.',503);}
  let glossary={};try{glossary=JSON.parse(env['SUBTITLE_GLOSSARY_'+row.target.toUpperCase()+'_JSON']||'{}');if(!glossary||Array.isArray(glossary)||typeof glossary!=='object')glossary={};}catch{}
  const polish=(source,text)=>row.target==='he'?enforceMemory(source,polishHebrew(source,text,data.profile),data.seriesMemory?.entities||[]):text;
  resolveQuality(data,glossary,polish);
  timings.translationMs+=Date.now()-translationStarted;
  if(!error&&data.units.every(u=>u.translated)&&data.refinement?.enabled&&!data.refinement.done){
    const configuredSize=Number(env.GEMINI_REFINEMENT_BATCH_SIZE)||96;
    const size=data.refinement.batchSize||Math.max(24,Math.min(120,configuredSize));
    const batch=refinementBatch(data,data.refinement.cursor,size);data.refinement.total=batch.total;
    const refinementStarted=Date.now();
    let retrySmaller=false;
    if(batch.items.length){
      const before=new Map(batch.items.map(x=>[x.id,x.draft]));
      const result=await refineItems(batch.items,{env,fetcher,glossary,memory:memorySlice(data.seriesMemory?.entities||[],batch.items)});
      if(result.retryable)error=new AddonError('GEMINI_QUOTA',result.error,429);
      else if(result.failed&&size>24){data.refinement.batchSize=Math.max(24,Math.floor(size/2));retrySmaller=true;}
      else commitRefinement(data,result.items);
      data.refinement.changed+=result.items.filter(x=>x.candidate!==before.get(x.id)).length;data.refinement.issues+=result.issues.length;if(result.failed)data.refinement.failedBatches++;
    }
    timings.refinementMs+=Date.now()-refinementStarted;
    if(!error&&!retrySmaller){data.refinement.cursor=batch.next;data.refinement.done=batch.done;}
  }
  timings.steps++;
  // Final deterministic consistency pass also covers editor/judge replacements.
  resolveQuality(data,glossary,polish);
  const state=data.units.every(u=>u.translated)&&(!data.refinement?.enabled||data.refinement.done)?'ready':error?'paused':'processing';
  if(state==='ready'){data.readability=readabilityStats(data);data.outputRevision=token();}
  const updated=await db.prepare('UPDATE jobs SET data=?,state=?,error=?,lease=NULL,lease_until=0 WHERE id=? AND lease=? RETURNING *')
    .bind(JSON.stringify(data),state,error?.message||null,id,lease).first();
  if(!updated){const fresh=await getJob(db,id);return {...status(fresh),busy:fresh.state!=='ready'};}
  await db.prepare('UPDATE subtitle_requests SET updated=?,state=?,error_code=?,message=? WHERE job_id=?').bind(Date.now(),state,error?.code||null,error?.message||null,id).run();
  return {...status(updated),errorCode:error?.code||null};
}
async function findSubtitles(db,config,m,origin,fetcher){
  config.mediaId=m.id.split(':')[0];
  config.episodeId=m.id;
  const tracks=config.boundSource?[config.boundSource,...(config.boundReferences||[])]:await lookup(db,m,config.target,fetcher,config.contextEnabled);
  // Publish prepared release choices to TV clients as distinct subtitle entries.
  const releasePrefix=`prepared:${m.type}:${m.id}:${config.target}:`;
  const prepared=[];
  if(!config.releaseId){
    const rows=await db.prepare("SELECT json_group_array(json(data)) AS data FROM (SELECT l.data FROM lookups l JOIN jobs j ON j.id=json_extract(l.data,'$.jobId') WHERE l.id>=? AND l.id<? AND l.expires>? AND j.expires>? AND j.state='ready' AND COALESCE(json_extract(j.data,'$.refinement.model'),'')=? ORDER BY j.created DESC LIMIT 12)").bind(releasePrefix,releasePrefix+'~',Date.now(),Date.now(),config.refinementModel||'').first();
    for(const entry of JSON.parse(rows?.data||'[]'))prepared.push({...entry,id:`bridge-machine-${entry.jobId}`,url:`${origin}/files/${entry.jobId}.srt?v=${SERIES_MEMORY_VERSION}`,lang:LANGUAGES[config.target][1],title:`Translated · ${entry.label}`});
  }
  let {existing,sources}=selectTracks(tracks,config.target,m.extra);
  if(config.stremio)return stremioChoices(db,config,m,origin,fetcher,{existing,sources,prepared,references:referenceTracks(tracks)});
  if(config.releaseId){
    const options=await releaseOptions(tracks,config.target,m.extra,selectTracks,hash);
    const choice=options.find(x=>x.id===config.releaseId);
    if(!choice)throw new AddonError('RELEASE_EXPIRED','This release is no longer available. Load the release list again.',409);
    const chosen=[];for(const track of choice.kind==='existing'?existing:sources)if(await hash(track.url)===choice.id)chosen.push(track);
    existing=choice.kind==='existing'?chosen:[];sources=choice.kind==='translate'?chosen:[];
  }
  const publicPrepared=prepared.map(({id,url,lang,title})=>({id,url,lang,title}));
  if(existing.length)return {subtitles:[...existing.slice(0,12).map((s,i)=>({id:String(s.id||i),url:s.url,lang:LANGUAGES[config.target][1],title:releaseLabel(s)})),...publicPrepared],bridge:{state:'existing',message:'Existing subtitles found. Translation was not needed.',release:releaseLabel(existing[0])},cacheMaxAge:60};
  if(prepared.length&&!sources.length)return {subtitles:publicPrepared,bridge:{state:'existing',message:'Prepared release subtitles are available. Choose the one matching your video.'},cacheMaxAge:30};
  if(!sources.length)return {subtitles:[],bridge:{state:'missing',message:'No existing target-language track or English source track was found. Audio transcription is not supported.'},cacheMaxAge:30};
  let cues,lastError,selectedSource;
  for(const source of sources.slice(0,3)){
    try{
      const key='source:'+await hash(source.url);const cached=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind(key,Date.now()).first();
      if(cached)cues=JSON.parse(cached.data);
      else{cues=parseSubtitles(await safeDownload(source.url,fetcher));await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(key,JSON.stringify(cues),Date.now()+3600000).run();}
      selectedSource=source;break;
    }catch(e){lastError=e;}
  }
  if(!cues)throw lastError||new AddonError('SOURCE_DOWNLOAD','No usable English subtitle file was found.');
  if(config.contextEnabled){
    const refs=referenceTracks(tracks);
    if(refs.length>=1){const results=await boundedMap(refs,async ref=>{const key='source:'+await hash(ref.url);const cached=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind(key,Date.now()).first();const refCues=cached?JSON.parse(cached.data):parseSubtitles(await safeDownload(ref.url,fetcher));if(!cached)await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(key,JSON.stringify(refCues),Date.now()+3600000).run();return {...ref,cues:refCues};},3);config.references=results.filter(r=>r.status==='fulfilled').map(r=>r.value);}
  }
  const row=await createJob(db,cues,config);
  const sourceId=await hash(selectedSource.url);
  await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(releasePrefix+sourceId,JSON.stringify({jobId:row.id,sourceId,label:sourceLabel(selectedSource),source:selectedSource}),row.expires).run();
  return {subtitles:[{id:`bridge-machine-${row.id}`,url:`${origin}/files/${row.id}.srt?v=${SERIES_MEMORY_VERSION}`,lang:LANGUAGES[config.target][1],title:`Translated · ${sourceLabel(selectedSource)}`}],bridge:{...status(row),release:sourceLabel(selectedSource),sourceId,releaseMatch:releaseMatch(selectedSource,m.extra)},cacheMaxAge:0};
}
async function stremioChoices(db,config,m,origin,fetcher,{existing,sources,prepared,references}){
  const lang=LANGUAGES[config.target][1],subtitles=[],seenSources=new Set();let bridge=null;
  // Each English subtitle gets its own immutable source binding. Discovery never
  // translates all releases: non-default choices prepare only when selected.
  for(const source of sources.slice(0,12)){
    const sourceId=await hash(source.url);if(seenSources.has(sourceId))continue;seenSources.add(sourceId);
    const ready=prepared.find(p=>p.sourceId===sourceId);
    const link=await hash(JSON.stringify([RELEASE_MATCH_VERSION,config.installKey,m.type,m.id,Object.fromEntries(Object.entries(m.extra).sort()),sourceId]));
    await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind('translation-link:'+link,JSON.stringify({key:config.installKey,media:m,source,sourceId,references}),Date.now()+7*DAY).run();
    let subtitle={id:`bridge-release-${sourceId}`,url:`${origin}/translations/${link}.srt`,lang,title:`${ready?'Translated':'Translate'} · ${sourceLabel(source)} · ${matchLabel(source,m.extra)}`};
    if(ready){subtitle.url=ready.url;}
    if(subtitles.length===0&&(!existing.length&&(!prepared.length||ready))){
      const result=await findSubtitles(db,{...config,stremio:false,releaseId:sourceId,boundSource:source,boundReferences:references},m,origin,fetcher);bridge=result.bridge;subtitle.url=result.subtitles[0].url;
    }
    else if(ready)bridge??={state:'existing',message:'Prepared source choices are available; check the release label.',release:sourceLabel(source),sourceId,releaseMatch:releaseMatch(source,m.extra)};
    subtitles.push(subtitle);
  }
  const native=existing.slice(0,12).map((s,i)=>({id:`native-${String(s.id||i)}`,url:s.url,lang,title:`Existing · ${sourceLabel(s)} · ${matchLabel(s,m.extra)}`}));
  // Verified native matches first. Unknown native/saved releases cannot hide a
  // separately timed English source. Old records remain visible but unverified.
  const verified=native.filter((_,i)=>['hash','filename'].includes(releaseMatch(existing[i],m.extra))),other=native.filter(s=>!verified.includes(s));
  const legacy=prepared.filter(p=>!p.sourceId||!seenSources.has(p.sourceId)).map(p=>({id:p.id,url:p.url,lang,title:`Saved · ${p.label} · Timing unverified`}));
  const all=[...verified,...subtitles,...other,...legacy];
  if(!all.length)return {subtitles:[],bridge:{state:'missing',message:'No existing target-language track or English source track was found. Audio transcription is not supported.'},cacheMaxAge:0};
  return {subtitles:all.map(s=>({...s,label:`${LANGUAGES[config.target][0]} · ${s.title}`})),bridge:bridge||{state:'existing',message:'Choose the subtitle source matching your video; unverified choices may need a timing adjustment.'},cacheMaxAge:0};
}
async function subtitleResponse(request,id,content,expires,cache='rendered'){
 const etag=`"srt-v2-${await hash(content)}"`,ttl=Math.max(0,Math.min(3600,Math.floor((expires-Date.now())/1000)));
 const headers={...cors,'X-Subtitle-Cache':cache,'Content-Type':'application/x-subrip; charset=utf-8','Cache-Control':`public, max-age=${ttl}`,ETag:etag,'Content-Disposition':'inline; filename="subtitle-bridge.srt"'};
 return new Response(request.headers.get('If-None-Match')===etag?null:content,{status:request.headers.get('If-None-Match')===etag?304:200,headers});
}
async function input(request){
  try{const body=JSON.parse(await readLimited(request,4096));if(!body||typeof body!=='object'||Array.isArray(body))throw new AddonError('JSON','Expected a JSON object.',400);return body;}catch(e){if(e instanceof AddonError)throw e;throw new AddonError('JSON','Invalid request.',400);}
}
const SAMPLE='1\n00:00:01,000 --> 00:00:03,500\nHello, welcome to our movie night.\n\n2\n00:00:04,000 --> 00:00:06,500\nThe story starts here.\n';
export async function handle(request,db,fetcher=fetch,env={}){
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method==='HEAD'){
    const translation=path.match(/^\/translations\/([a-f0-9]{64})\.srt$/);
    if(translation){const binding=db?await db.prepare('SELECT expires FROM lookups WHERE id=? AND expires>?').bind('translation-link:'+translation[1],Date.now()).first():null;return new Response(null,{status:binding?200:404,headers:{...cors,'Content-Type':'application/x-subrip; charset=utf-8','Cache-Control':'no-store'}});}
    const file=path.match(/^\/files\/([a-f0-9]{32})\.srt$/);
    if(file){try{const row=await getJob(db,file[1]);return new Response(null,{status:row.state==='ready'?200:503,headers:{...cors,'Content-Type':'application/x-subrip; charset=utf-8'}});}catch{return new Response(null,{status:404,headers:cors});}}
    const response=await handle(new Request(request.url,{method:'GET',headers:request.headers}),db,fetcher,env);
    return new Response(null,{status:response.status,headers:response.headers});
  }
  try{
    if(path==='/api/refinement-status'&&request.method==='GET')return json({enabled:env.GEMINI_REFINEMENT_ENABLED==='true'&&Boolean(env.GEMINI_API_KEY),model:env.GEMINI_REFINEMENT_MODEL||'gemini-3.5-flash-lite'});
    if(path==='/health')return json({ok:true,version:'0.16.0'});
    if(path==='/health/ready'){if(!db)throw new AddonError('STORAGE','Database unavailable.',503);await db.prepare('SELECT 1 AS ok').bind().first();return json({ok:true,database:'ready',version:'0.16.0'});}
    if(path==='/manifest.json'&&request.method==='GET')return json(manifest());
    const configure=path.match(/^\/addon\/([^/]+)\/configure$/);
    if(configure)return Response.redirect(`${url.origin}/?config=${encodeURIComponent(configure[1])}`,302);
    if(!db)throw new AddonError('STORAGE','Persistent storage is unavailable.',503);
    const translation=path.match(/^\/translations\/([a-f0-9]{64})\.srt$/);
    if(translation&&request.method==='GET'){
      const saved=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind('translation-link:'+translation[1],Date.now()).first();
      if(!saved)throw new AddonError('RELEASE_EXPIRED','This subtitle choice expired. Refresh the Stremio subtitle list.',404);
      const binding=JSON.parse(saved.data),config=configureRefinement(await configuration(db,binding.key),env);
      config.contextEnabled=env.GOOGLE_TRANSLATE_ENABLED==='true'&&env.GOOGLE_RPC_BATCH_ENABLED!=='false';config.ip=clientIp(request);config.alternative=providers(env)[0].name!=='mymemory';config.providerVersion=await hash(JSON.stringify(providers(env).map(p=>[p.name,p.url])));
      config.releaseId=binding.sourceId;config.boundSource=binding.source;config.boundReferences=binding.references||[];
      const result=await trackRequest(db,config,binding.media,'stremio',async()=>{await rate(db,request,'lookup',100);return findSubtitles(db,config,binding.media,url.origin,fetcher);},status);
      if(!result.bridge?.id)throw new AddonError('SOURCE_DOWNLOAD','This English subtitle could not be prepared.',503);
      const response=await handle(new Request(`${url.origin}/files/${result.bridge.id}.srt?v=${SERIES_MEMORY_VERSION}`,{headers:request.headers}),db,fetcher,env);
      const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});
    }
    if(path==='/api/requests'&&request.method==='GET'){authorizeHistory(request,env);return json(await listRequests(db,url,status),200,{'Cache-Control':'private, no-store'});}
    const memoryMatch=path.match(/^\/api\/context\/(tt\d{5,12})$/);
    if(memoryMatch&&request.method==='GET'){authorizeHistory(request,env);return json(await readMemory(db,memoryKey(memoryMatch[1],'he',env.GEMINI_REFINEMENT_MODEL||'gemini-3.5-flash-lite')),200,{'Cache-Control':'private, no-store'});}
    if(path==='/api/config'&&request.method==='POST'){
      await rate(db,request,'config',10);await cleanup(db);
      const body=await input(request),target=language(body.target),email=String(body.email||'').trim().toLowerCase();
      if(!target||!LANGUAGES[target])throw new AddonError('LANGUAGE','Choose a supported language.',400);
      if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||body.consent!==true))throw new AddonError('EMAIL','Enter your own valid contact email and accept sharing it with MyMemory.',400);
      if(!email)return json({key:target,manifest:`${url.origin}/addon/${target}/manifest.json`});
      const id=token();await db.prepare('INSERT INTO configs(id,target,email,created) VALUES(?,?,?,?)').bind(id,target,email,Date.now()).run();
      return json({key:id,manifest:`${url.origin}/addon/${id}/manifest.json`},201);
    }
    let match=path.match(/^\/api\/config\/([a-f0-9]{32})$/);
    if(match&&request.method==='DELETE'){
      const config=await configuration(db,match[1]);
      // The random installation token authorizes deleting this configuration.
      await db.prepare('DELETE FROM configs WHERE id=?').bind(match[1]).run();
      // Clear retained contact information on related jobs, without changing their cache identity.
      await db.prepare('UPDATE jobs SET email=\'\' WHERE email=?').bind(config.email).run();
      return json({deleted:true});
    }
    match=path.match(/^\/addon\/([^/]+)\/manifest\.json$/);
    if(match&&request.method==='GET')return json(manifest((await configuration(db,match[1])).target));
    match=path.match(/^\/addon\/([^/]+)\/subtitles\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/);
    if(match&&request.method==='GET'){
      const config=configureRefinement(await configuration(db,match[1]),env);config.contextEnabled=env.GOOGLE_TRANSLATE_ENABLED==='true'&&env.GOOGLE_RPC_BATCH_ENABLED!=='false';config.ip=clientIp(request);config.alternative=providers(env)[0].name!=='mymemory';config.providerVersion=await hash(JSON.stringify(providers(env).map(p=>[p.name,p.url])));
      config.stremio=true;config.installKey=match[1];
      const m=media(match[2],decodeURIComponent(match[3]),match[4]||'');
      return json(await trackRequest(db,config,m,'stremio',async()=>{await rate(db,request,'lookup',100);return findSubtitles(db,config,m,url.origin,fetcher);},status));
    }
    if(path==='/api/search'&&request.method==='POST'){
      const {type,query}=searchInput(await input(request));
      await rate(db,request,'search',200);
      const cacheId='search:'+await hash(JSON.stringify([type,query.toLowerCase()]));
      const cached=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind(cacheId,Date.now()).first();
      if(cached)return json(JSON.parse(cached.data));
      let result;
      try{const response=await fetcher(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(query)}.json`,{redirect:'manual',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('upstream');result=searchResults(JSON.parse(await readLimited(response,1500000)),type);
      }catch{throw new AddonError('SEARCH_SOURCE','Title search is unavailable. Retry or paste an IMDb link.',503);}
      await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(cacheId,JSON.stringify(result),Date.now()+3600000).run();
      return json(result);
    }
    if(path==='/api/episodes'&&request.method==='POST'){
      await rate(db,request,'episodes',30);
      const body=await input(request),id=String(body.id||'');
      if(!/^tt\d{5,12}$/.test(id))throw new AddonError('MEDIA_ID','Enter a series IMDb ID.',400);
      const cacheId='episodes:'+id;
      const cached=await db.prepare('SELECT data FROM lookups WHERE id=? AND expires>?').bind(cacheId,Date.now()).first();
      if(cached)return json(episodeList(JSON.parse(cached.data),id));
      let meta;
      try{const response=await fetcher(`https://v3-cinemeta.strem.io/meta/series/${id}.json`,{redirect:'manual',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('upstream');meta=JSON.parse(await readLimited(response,2000000)).meta;
      }catch{throw new AddonError('SERIES_SOURCE','Could not load the episode list. Please retry.',503);}
      const result=episodeList(meta,id);
      await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(cacheId,JSON.stringify(meta),Date.now()+3600000).run();
      return json(result);
    }
    if(path==='/api/releases'&&request.method==='POST'){
      await rate(db,request,'lookup',100);
      const body=await input(request),config=await configuration(db,String(body.key||'he'));
      const m=media(body.type,String(body.id||''),new URLSearchParams(body.filename?{filename:String(body.filename)}:{}).toString());
      const tracks=await lookup(db,m,config.target,fetcher,env.GOOGLE_TRANSLATE_ENABLED==='true'&&env.GOOGLE_RPC_BATCH_ENABLED!=='false');
      return json({options:await releaseOptions(tracks,config.target,m.extra,selectTracks,hash)});
    }
    if(path==='/api/prepare'&&request.method==='POST'){
      await cleanup(db);
      const body=await input(request),config=configureRefinement(await configuration(db,String(body.key||'he')),env);config.contextEnabled=env.GOOGLE_TRANSLATE_ENABLED==='true'&&env.GOOGLE_RPC_BATCH_ENABLED!=='false';config.ip=clientIp(request);config.alternative=providers(env)[0].name!=='mymemory';config.providerVersion=await hash(JSON.stringify(providers(env).map(p=>[p.name,p.url])));
      const m=media(body.type,String(body.id||''),new URLSearchParams(body.filename?{filename:String(body.filename)}:{}).toString());
      if(body.releaseId){if(!/^[a-f0-9]{64}$/.test(body.releaseId))throw new AddonError('RELEASE','Invalid release choice.',400);config.releaseId=body.releaseId;}
      return json(await trackRequest(db,config,m,'setup',async()=>{await rate(db,request,'lookup',100);return findSubtitles(db,config,m,url.origin,fetcher);},status));
    }
    if(path==='/api/demo'&&request.method==='POST'){
      await rate(db,request,'demo',10);await cleanup(db);
      const body=await input(request),config=configureRefinement(await configuration(db,String(body.key||'he')),env);config.contextEnabled=env.GOOGLE_TRANSLATE_ENABLED==='true'&&env.GOOGLE_RPC_BATCH_ENABLED!=='false';config.ip=clientIp(request);config.alternative=providers(env)[0].name!=='mymemory';config.providerVersion=await hash(JSON.stringify(providers(env).map(p=>[p.name,p.url])));
      if(config.target==='en')return json({sample:SAMPLE,state:'existing'});
      return json(status(await createJob(db,parseSubtitles(SAMPLE),config)));
    }
    match=path.match(/^\/api\/jobs\/([a-f0-9]{32})(\/step)?$/);
    if(match){
      if(request.method==='GET'&&!match[2])return json(status(await getJob(db,match[1])));
      if(request.method==='POST'&&match[2]){
        await rate(db,request,'step',1500);
        return json(await step(db,match[1],fetcher,env));
      }
    }
    match=path.match(/^\/files\/([a-f0-9]{32})\.srt$/);
    if(match&&request.method==='GET'){
      const id=match[1];
      let row=await getJob(db,id),calls=0;
      const fileKey=job=>'file:v3:'+id+':'+(JSON.parse(job.data).outputRevision||'initial');
      const cached=row.state==='ready'?await db.prepare('SELECT data,expires FROM lookups WHERE id=? AND expires>?').bind(fileKey(row),Date.now()).first():null;
      if(cached)return subtitleResponse(request,id,cached.data,cached.expires,'durable-hit');
      const deadline=Date.now()+75000;
      // Relay bounded work to fresh invocations; never exhaust one Worker's subrequest budget.
      while(row.state!=='ready'&&Date.now()<deadline&&calls++<35){
        const res=await fetcher(`${env.PUBLIC_ORIGIN||url.origin}/api/jobs/${id}/step`,{method:'POST',signal:AbortSignal.timeout(110000)});
        if(!res.ok)throw new AddonError('PREPARE','Please prepare this subtitle on the setup page, then retry playback.',503);
        const progress=await res.json();
        if(progress.state==='paused')throw new AddonError(progress.errorCode||'PAUSED',progress.error||'Translation paused.',429);
        if(progress.busy)throw new AddonError('PREPARING','Translation is already running. Retry shortly or open the preparation page.',503);
        row={...row,state:progress.state};
      }
      if(row.state!=='ready')throw new AddonError('PREPARING','Translation is still running. Use the preparation page to finish it, then retry playback.',503);
      row=await getJob(db,id);
      const rendered=JSON.parse(row.data);
      let operatorTerms={};try{const parsed=JSON.parse(env['SUBTITLE_GLOSSARY_'+row.target.toUpperCase()+'_JSON']||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))operatorTerms=parsed;}catch{}
      resolveQuality(rendered,operatorTerms,(source,text)=>row.target==='he'?enforceMemory(source,text,rendered.seriesMemory?.entities||[]):text);
      const content=renderSrt(rendered);
      await db.prepare('INSERT INTO lookups(id,data,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind(fileKey(row),content,row.expires).run();
      return subtitleResponse(request,id,content,row.expires);
    }
    return json({error:'NOT_FOUND',message:'Route not found.'},404);
  }catch(e){
    if(!(e instanceof AddonError))console.error('Unhandled add-on failure',{name:e?.name||'Error',message:String(e?.message||'').replace(/https?:\/\/[^\s]+/g,'[URL]').replace(/[^\s@]+@[^\s@]+/g,'[EMAIL]').slice(0,300)});
    const err=e instanceof AddonError?e:new AddonError('UNAVAILABLE','The service could not complete this request. Please retry.',503);
    const payload={error:err.code,message:err.message};
    // Do not cache transient failures as proof that no subtitles exist.
    if(path.includes('/subtitles/'))payload.subtitles=[];
    return json(payload,err.status,err.status===429||err.status===503?{'Retry-After':'30'}:{});
  }
}
