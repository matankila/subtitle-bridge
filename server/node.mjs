import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {handle} from '../lib/addon.mjs';
import {access,ownerEnv} from './access.mjs';
import {openDatabase} from './sqlite.mjs';
const port=Number(process.env.PORT||8787),hostname=process.env.HOST||'127.0.0.1';
const env=ownerEnv(process.env),origin=env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
const db=openDatabase(env.SQLITE_PATH);
const server=createServer(async(incoming,outgoing)=>{
 try{
  const headers=new Headers();for(const [key,value] of Object.entries(incoming.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
  // Standalone Node has no trusted Cloudflare proxy. Do not accept spoofed IPs.
  headers.delete('cf-connecting-ip');headers.set('cf-connecting-ip',incoming.socket.remoteAddress||'');
  const method=incoming.method||'GET',init={method,headers,...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(incoming),duplex:'half'}:{})};
  const request=new Request(new URL(incoming.url||'/',origin),init);const guarded=await access(request,env);
  let response=guarded.response;
  if(!response&&new URL(request.url).pathname==='/')response=new Response(`<!doctype html><html><meta charset="utf-8"><title>Subtitle Bridge API</title><h1>Subtitle Bridge</h1><p>The standalone API is running. Use the Cloudflare/Vinext build for the complete preparation UI.</p><p><a href="/addon/he/manifest.json">Hebrew Stremio manifest</a></p><p><a href="/health/ready">Database health</a></p></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  response??=await handle(guarded.request,db,fetch,{...env,PUBLIC_ORIGIN:origin});
  outgoing.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(outgoing);else outgoing.end();
 }catch{outgoing.writeHead(500,{'Content-Type':'application/json'});outgoing.end('{"error":"INTERNAL","message":"Request failed."}');}
});
server.requestTimeout=180000;server.listen(port,hostname,()=>console.log(`Subtitle Bridge API listening on ${hostname}:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
