import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {copyTitle, defaults, type Workflow, type Settings} from '../shared/domain.ts';

const missing = () => Object.assign(new Error('方案不存在'), {status: 404});
const trashed = () => Object.assign(new Error('方案已移入回收站'), {status: 404});

export class Store {
    db: DatabaseSync;

    constructor(path: string) {
        if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
    }

    private read(id: string): Workflow {
        const row = this.db.prepare('SELECT body FROM documents WHERE id=?').get(id) as { body: string } | undefined;
        if (!row) throw missing();
        return JSON.parse(row.body)
    }

    /** `includeTrashed` is only for restore/purge; every user-facing read hides the trash. */
    get(id: string, includeTrashed = false): Workflow {
        const w = this.read(id);
        if (w.trashedAt && !includeTrashed) throw trashed();
        return w
    }

    all(trashedList = false): Workflow[] {
        const at = (w: Workflow) => trashedList ? (w.trashedAt || w.updatedAt) : w.updatedAt;
        return (this.db.prepare('SELECT body FROM documents').all() as {
            body: string
        }[]).map(r => JSON.parse(r.body) as Workflow)
            .filter(w => !!w.trashedAt === trashedList)
            .sort((a, b) => at(b).localeCompare(at(a)))
    }

    put(w: Workflow) {
        w.updatedAt = new Date().toISOString();
        this.db.prepare('INSERT OR REPLACE INTO documents VALUES (?,?)').run(w.id, JSON.stringify(w));
        return w
    }

    mutate(id: string, fn: (w: Workflow) => void, version?: number, conflict = '版本已变化，请刷新后处理；本地草稿已保留') {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const w = this.get(id);
            if (version !== undefined && w.version !== version) throw Object.assign(new Error(conflict), {status: 409});
            fn(w);
            w.version++;
            this.put(w);
            this.db.exec('COMMIT');
            return w
        } catch (e) {
            this.db.exec('ROLLBACK');
            throw e
        }
    }

    rename(id: string, title: string, version?: number) {
        return this.mutate(id, w => {
            w.title = title
        }, version, '方案已在其他窗口更新，请刷新后重试')
    }

    /** Move to trash in one transaction, letting the caller stop an in-flight generation first. */
    trash(id: string, version?: number, before?: (w: Workflow) => void) {
        return this.mutate(id, w => {
            before?.(w);
            w.trashedAt = new Date().toISOString()
        }, version)
    }

    restore(id: string, version?: number) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const w = this.read(id);
            if (!w.trashedAt) throw Object.assign(new Error('方案不在回收站'), {status: 409});
            if (version !== undefined && w.version !== version) throw Object.assign(new Error('方案已在其他窗口更新，请刷新后重试'), {status: 409});
            w.trashedAt = undefined;
            w.version++;
            this.put(w);
            this.db.exec('COMMIT');
            return w
        } catch (e) {
            this.db.exec('ROLLBACK');
            throw e
        }
    }

    purge(id: string) {
        const w = this.read(id);
        if (!w.trashedAt) throw Object.assign(new Error('请先将方案移入回收站'), {status: 409});
        this.db.prepare('DELETE FROM documents WHERE id=?').run(id);
        return w
    }

    emptyTrash(expected: number) {
        const list = this.all(true);
        if (!Number.isInteger(expected) || expected !== list.length) throw Object.assign(new Error('回收站已变化，请刷新后重试'), {status: 409});
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const remove = this.db.prepare('DELETE FROM documents WHERE id=?');
            for (const w of list) remove.run(w.id);
            this.db.exec('COMMIT');
            return list.length
        } catch (e) {
            this.db.exec('ROLLBACK');
            throw e
        }
    }

    /** Independent copy of a saved plan; generation state, candidate and confirmation timestamps are dropped. */
    duplicate(id: string) {
        const w = this.get(id), now = new Date().toISOString(), source = structuredClone(w);
        const copy: Workflow = {
            ...source,
            id: randomUUID(),
            title: copyTitle(w.title),
            version: 1,
            createdAt: now,
            updatedAt: now,
            trashedAt: undefined,
            candidate: undefined,
            job: undefined,
            revisions: source.revisions.map(r => ({...r, confirmedAt: undefined}))
        };
        this.put(copy);
        return copy
    }

    settings(): Settings {
        const row = this.db.prepare('SELECT body FROM settings WHERE id=1').get() as { body: string } | undefined;
        return row ? JSON.parse(row.body) : structuredClone(defaults)
    }

    saveSettings(s: Settings) {
        this.db.prepare('INSERT OR REPLACE INTO settings VALUES (1,?)').run(JSON.stringify(s));
        return s
    }
}
