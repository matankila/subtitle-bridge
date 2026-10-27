import {AddonError} from './subtitles.mjs';
export function searchInput(body){
 const type=body?.type,query=typeof body?.query==='string'?body.query.normalize('NFKC').trim().replace(/\s+/g,' '):'';
 if(!['movie','series'].includes(type)||query.length<2||query.length>100||/[\x00-\x1f\x7f]/.test(query))throw new AddonError('SEARCH_INPUT','Enter 2–100 characters and choose movies or series.',400);
 return {type,query};
}
export function searchResults(data,type){
 if(!Array.isArray(data?.metas))throw new AddonError('SEARCH_SOURCE','Title search is unavailable. Retry or paste an IMDb link.',503);
 const seen=new Set(),results=[];
 for(const m of data.metas){
  if(!m||m.type!==type||!/^tt\d{5,12}$/.test(m.id)||typeof m.name!=='string'||!m.name.trim()||seen.has(m.id))continue;
  seen.add(m.id);results.push({id:m.id,name:m.name.trim().slice(0,200),year:typeof m.releaseInfo==='string'?m.releaseInfo.slice(0,40):''});
  if(results.length===10)break;
 }
 return {results};
}
