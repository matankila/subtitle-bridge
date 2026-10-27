import {AddonError} from './subtitles.mjs';
export function episodeList(meta,id,now=Date.now()){
 if(!Array.isArray(meta?.videos))throw new AddonError('SERIES','No episode list is available for this title.',404);
 const seen=new Set(); const episodes=[];
 for(const v of meta.videos){
  const season=Number(v.season),episode=Number(v.episode),released=Date.parse(v.released);
  if(!Number.isInteger(season)||season<0||season>9999||!Number.isInteger(episode)||episode<1||episode>9999||!Number.isFinite(released)||released>now)continue;
  const key=`${id}:${season}:${episode}`;if(seen.has(key))continue;seen.add(key);
  episodes.push({id:key,season,episode,title:String(v.title||v.name||`Episode ${episode}`).slice(0,200),released:new Date(released).toISOString()});
 }
 episodes.sort((a,b)=>a.season-b.season||a.episode-b.episode);
 if(episodes.length>2000)throw new AddonError('SERIES_SIZE','This series has too many episodes for one list.',400);
 return {id,name:String(meta.name||id).slice(0,200),episodes};
}
