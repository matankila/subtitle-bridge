import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
export function openDatabase(filename='./data/subtitle-bridge.sqlite'){
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true});
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY)');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
  if(sqlite.prepare('SELECT name FROM _local_migrations WHERE name=?').get(name))continue;
  sqlite.exec('BEGIN IMMEDIATE');try{sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO _local_migrations(name) VALUES(?)').run(name);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(column){const row=sqlite.prepare(sql).get(...args)||null;return column?row?.[column]??null:row;},async all(){return {results:sqlite.prepare(sql).all(...args),success:true};},run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:result.changes}};}});
 return {sqlite,prepare:sql=>wrap(sql),async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();}};
}
