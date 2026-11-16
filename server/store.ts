import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {defaults,type Workflow,type Settings} from '../shared/domain.ts';
export class Store {
 db:DatabaseSync;
 constructor(path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')}
 get(id:string):Workflow {const row=this.db.prepare('SELECT body FROM documents WHERE id=?').get(id) as {body:string}|undefined;if(!row)throw Object.assign(new Error('方案不存在'),{status:404});return JSON.parse(row.body)}
 all():Workflow[]{return (this.db.prepare('SELECT body FROM documents').all() as {body:string}[]).map(r=>JSON.parse(r.body)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
 put(w:Workflow){w.updatedAt=new Date().toISOString();this.db.prepare('INSERT OR REPLACE INTO documents VALUES (?,?)').run(w.id,JSON.stringify(w));return w}
 mutate(id:string,fn:(w:Workflow)=>void,version?:number){this.db.exec('BEGIN IMMEDIATE');try{const w=this.get(id);if(version!==undefined&&w.version!==version)throw Object.assign(new Error('版本已变化，请刷新后处理；本地草稿已保留'),{status:409});fn(w);w.version++;this.put(w);this.db.exec('COMMIT');return w}catch(e){this.db.exec('ROLLBACK');throw e}}
 settings():Settings{const row=this.db.prepare('SELECT body FROM settings WHERE id=1').get() as {body:string}|undefined;return row?JSON.parse(row.body):structuredClone(defaults)}
 saveSettings(s:Settings){this.db.prepare('INSERT OR REPLACE INTO settings VALUES (1,?)').run(JSON.stringify(s));return s}
}
