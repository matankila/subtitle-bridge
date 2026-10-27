import handler from 'vinext/server/fetch-handler';
import {access,ownerEnv} from '../server/access.mjs';
export default {
 async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  const guarded=await access(request,env);if(guarded.response)return guarded.response;
  const work=handler.fetch(guarded.request!,ownerEnv(env),ctx);
  if(/^\/(?:files\/|translations\/|api\/jobs\/[a-f0-9]{32}\/step)/.test(new URL(request.url).pathname))ctx.waitUntil(work.then(()=>{},()=>{}));
  return work;
 }
};
