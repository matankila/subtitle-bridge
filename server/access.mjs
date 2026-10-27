import {timingSafeEqual} from 'node:crypto';
import {readLimited} from '../lib/http.mjs';
const cookieName='sb_admin';
function same(a,b){const x=new TextEncoder().encode(String(a||'')),y=new TextEncoder().encode(String(b||''));return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);}
export async function access(request,env={}){
 const url=new URL(request.url),secret=String(env.ADMIN_TOKEN||''),configured=secret.length>=32&&!/^(?:REPLACE_|CHANGE_|YOUR_)/.test(secret);
 if(url.pathname==='/api/admin/login'&&request.method==='POST'){
  if(!configured)return {response:Response.json({message:'Set an ADMIN_TOKEN of at least 32 characters.'},{status:503})};
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return {response:new Response(null,{status:403})};
  let token;try{token=JSON.parse(await readLimited(new Response(request.body),2048)).token;}catch{return {response:Response.json({message:'Invalid request.'},{status:400})};}
  if(!same(token,secret))return {response:Response.json({message:'Invalid admin token.'},{status:401})};
  return {response:Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`${cookieName}=${encodeURIComponent(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400${url.protocol==='https:'?'; Secure':''}`}})};
 }
 if(url.pathname==='/api/admin/logout'&&request.method==='POST')return {response:Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`}})};
 const headers=new Headers(request.headers);
 // Direct clients must never be allowed to impersonate the hosted identity proxy.
 for(const key of [...headers.keys()])if(key.startsWith('oai-authenticated-'))headers.delete(key);
 // Cross-origin requests cannot use a browser's admin cookie for privileged work.
 const sameOrigin=!headers.get('Origin')||headers.get('Origin')===url.origin;
 let cookie='';try{cookie=decodeURIComponent(headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'');}catch{}
 const bearer=headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(configured&&(same(bearer,secret)||(sameOrigin&&same(cookie,secret)))){
  headers.set('oai-authenticated-user-id','instance-admin');headers.set('oai-authenticated-user-email',env.REQUEST_HISTORY_OWNER_EMAIL||'owner@localhost');
 }
 return {request:new Request(request,{headers})};
}
export const ownerEnv=env=>({...env,REQUEST_HISTORY_OWNER_EMAIL:env.REQUEST_HISTORY_OWNER_EMAIL||'owner@localhost'});
