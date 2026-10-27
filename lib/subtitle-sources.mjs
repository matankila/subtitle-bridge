import {readLimited} from './http.mjs';
import {AddonError,language} from './subtitles.mjs';
export async function discoverTracks(media,target,withReferences,fetcher){
 const suffix=new URLSearchParams(media.extra).toString(),resource=`/subtitles/${media.type}/${encodeURIComponent(media.id)}${suffix?'/'+suffix:''}.json`;
 const langs=target==='en'?'en':withReferences?`en|${target}|fr|es|ru`:`en|${target}`;
 const sources=[{name:'OpenSubtitles v3',url:`https://opensubtitles-v3.strem.io${resource}`},{name:'OpenSubtitles v3+',url:`https://opensubtitles.stremio.homes/${encodeURIComponent(langs)}/ai-translated=false%7Cfrom=all${resource}`}];
 const results=await Promise.allSettled(sources.map(async source=>{
  const r=await fetcher(source.url,{signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(!r.ok){await r.body?.cancel();throw new Error(`HTTP ${r.status}`);}
  const body=JSON.parse(await readLimited(r,1500000));if(!Array.isArray(body.subtitles))throw new Error('Invalid subtitle list');
  return body.subtitles.slice(0,600).filter(s=>{try{const u=new URL(s.url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}).map(s=>({...s,provider:source.name,title:s.title||s.movieReleaseName||s.subtitleFileName||s.id}));
 }));
 const tracks=[],seen=new Set();for(const result of results)if(result.status==='fulfilled')for(const track of result.value){if(seen.has(track.url))continue;seen.add(track.url);tracks.push(track);}
 // A partial outage with no usable source is unknown, never confirmed absence.
 const usable=tracks.some(s=>language(s.lang_code||s.lang)===target||language(s.lang_code||s.lang)==='en'&&!s.ai_translated);
 if(results.some(r=>r.status==='rejected')&&!usable)throw new AddonError('SOURCE_UNAVAILABLE','One or more subtitle providers are unavailable and no usable source was found. Retry later; absence is not confirmed.',503);
 return tracks;
}
