import test from 'node:test';
import assert from 'node:assert/strict';
import {access,ownerEnv} from '../server/access.mjs';
import {authorizeHistory} from '../lib/request-history.mjs';
import {openDatabase} from '../server/sqlite.mjs';
const env=ownerEnv({ADMIN_TOKEN:'test-only-admin-token-01234567890123456789'});
test('self-hosted boundary removes forged hosted identities and fails closed without admin authentication',async()=>{
 const request=new Request('https://instance.example/api/requests',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@localhost'}});
 const result=await access(request,env);assert.equal(result.request.headers.get('oai-authenticated-user-id'),null);assert.throws(()=>authorizeHistory(result.request,env),e=>e.status===401);
});
test('admin bearer and HttpOnly session authorize only the instance owner',async()=>{
 const auth=await access(new Request('https://instance.example/api/requests',{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}}),env);assert.doesNotThrow(()=>authorizeHistory(auth.request,env));
 const login=await access(new Request('https://instance.example/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:env.ADMIN_TOKEN})}),env);
 assert.equal(login.response.status,200);const cookie=login.response.headers.get('Set-Cookie');for(const marker of ['HttpOnly','SameSite=Strict','Secure'])assert.ok(cookie.includes(marker));
 const session=await access(new Request('https://instance.example/api/requests',{headers:{Cookie:cookie.split(';')[0]}}),env);assert.doesNotThrow(()=>authorizeHistory(session.request,env));
 const crossSite=await access(new Request('https://instance.example/api/requests',{headers:{Cookie:cookie.split(';')[0],Origin:'https://evil.example'}}),env);assert.throws(()=>authorizeHistory(crossSite.request,env));
});
test('placeholder admin secrets and wrong credentials never enable history access',async()=>{
 for(const [secret,token,status] of [['REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS','REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',503],[env.ADMIN_TOKEN,'wrong',401]]){const result=await access(new Request('https://instance.example/api/admin/login',{method:'POST',body:JSON.stringify({token})}),{ADMIN_TOKEN:secret});assert.equal(result.response.status,status);}
});
test('SQLite compatibility applies migrations once, supports bound queries and rolls back failed batches',async()=>{
 const db=openDatabase(':memory:');assert.ok((await db.prepare('SELECT count(*) AS n FROM _local_migrations').first()).n>=5);
 await assert.rejects(db.batch([db.prepare('INSERT INTO counters(id,used,expires) VALUES(?,?,?)').bind('rollback-test',1,Date.now()+1000),db.prepare('INSERT INTO missing_table(x) VALUES(?)').bind(1)]));assert.equal(await db.prepare('SELECT used FROM counters WHERE id=?').bind('rollback-test').first(),null);
 assert.equal((await db.prepare('SELECT name FROM sqlite_master WHERE name=?').bind('jobs').first('name')),'jobs');db.close();
});

test('SQLite batch rollback cannot expose partially applied writes to another request',async()=>{
 const db=openDatabase(':memory:');
 const pending=db.batch([db.prepare('INSERT INTO counters(id,used,expires) VALUES(?,?,?)').bind('invisible-partial',1,Date.now()+1000),db.prepare('INSERT INTO absent_table(x) VALUES(?)').bind(1)]);
 const observed=db.prepare('SELECT used FROM counters WHERE id=?').bind('invisible-partial').first();
 await assert.rejects(pending);assert.equal(await observed,null);db.close();
});
