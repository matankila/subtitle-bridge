// A release choice identifies an upstream subtitle, never a client-supplied URL.
export function releaseLabel(track){
 return String(track.title||track.movieReleaseName||track.subtitleFileName||track.release||track.name||track.id||'Unnamed release').replace(/<[^>]*>/g,'').slice(0,700);
}
export const RELEASE_MATCH_VERSION='release-bound-v2';
const normalized=value=>String(value||'').toLowerCase().replace(/\.(?:mkv|mp4|avi|srt|ass|ssa|vtt)$/i,'').replace(/[^\p{L}\p{N}]+/gu,'');
export function releaseMatch(track,extra={}){
 const requested=String(extra.videoHash||'').toLowerCase(),provided=String(track.moviehash||track.movieHash||'').toLowerCase();
 if(requested&&provided)return requested===provided?'hash':'mismatch';
 const name=normalized(extra.filename);
 return name&&[track.title,track.movieReleaseName,track.subtitleFileName].some(x=>normalized(x)===name)?'filename':'unverified';
}
export function sourceLabel(track){return `${releaseLabel(track)} · #${String(track.id||'source').replace(/[^\p{L}\p{N}_.-]/gu,'').slice(0,80)}`;}
export function matchLabel(track,extra){return ({hash:'Hash matched',filename:'Filename matched',mismatch:'Different video hash',unverified:'Timing unverified'})[releaseMatch(track,extra)];}
export async function releaseOptions(tracks,target,extra,selectTracks,hash){
 const {existing,sources}=selectTracks(tracks,target,extra),options=[];
 for(const track of [...existing,...sources]){
  const id=await hash(track.url);if(options.some(x=>x.id===id))continue;
  options.push({id,label:releaseLabel(track),kind:existing.includes(track)?'existing':'translate',language:existing.includes(track)?target:'en'});
 }
 return options;
}
