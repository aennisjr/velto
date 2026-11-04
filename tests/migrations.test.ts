import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations, type Migration } from '../src/database/migrations.js';
import { loadMigrations } from '../src/database/schema.js';
import { openTestDatabase } from './testDatabase.js';

const open: sqlite3.Database[] = [];

function track(db: sqlite3.Database): sqlite3.Database {
    open.push(db);
    return db;
}

afterEach(() => {
    for (const db of open.splice(0)) {
        db.close();
    }
});

const all = (db: sqlite3.Database, sql: string) =>
    new Promise<Record<string, unknown>[]>((resolve, reject) => db.all(sql, (error, rows) => (error ? reject(error) : resolve(rows as Record<string, unknown>[]))));

const version = async (db: sqlite3.Database) => Number((await all(db, 'PRAGMA user_version'))[0].user_version);

const tableNames = async (db: sqlite3.Database) =>
    (await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((row) => String(row.name));

describe('migrations', () => {
    it('brings a new database to the latest version', async () => {
        const db = track(await openTestDatabase());
        expect(await version(db)).toBe(loadMigrations().length);
        expect(await tableNames(db)).toEqual(expect.arrayContaining(['entries', 'tags', 'entry_tags', 'categories', 'template_variables']));
    });

    it('upgrades a database that predates versioning without losing data', async () => {
        const db = track(new sqlite3.Database(':memory:'));
        const [baseline] = loadMigrations();
        await new Promise<void>((resolve, reject) => db.exec(baseline.sql, (error) => (error ? reject(error) : resolve())));
        await new Promise<void>((resolve, reject) =>
            db.run("INSERT INTO entries (id, title, content, created_at, updated_at) VALUES ('1', 'Kept', 'body', 'a', 'a')", (error) => (error ? reject(error) : resolve())),
        );
        expect(await version(db)).toBe(0);

        await runMigrations(db, loadMigrations());
        expect(await version(db)).toBe(loadMigrations().length);
        expect(await all(db, 'SELECT title, syntax_language FROM entries')).toEqual([{ title: 'Kept', syntax_language: 'plaintext' }]);
    });

    it('is a no-op when already current', async () => {
        const db = track(await openTestDatabase());
        await runMigrations(db, loadMigrations());
        expect(await version(db)).toBe(loadMigrations().length);
    });

    it('applies only pending migrations, in order', async () => {
        const db = track(new sqlite3.Database(':memory:'));
        const steps: Migration[] = [
            { version: 1, sql: 'CREATE TABLE a (x INTEGER);' },
            { version: 2, sql: 'ALTER TABLE a ADD COLUMN y INTEGER;' },
        ];
        await runMigrations(db, [steps[0]]);
        expect(await version(db)).toBe(1);
        await runMigrations(db, [steps[1], steps[0]]);
        expect(await version(db)).toBe(2);
        expect((await all(db, 'PRAGMA table_info(a)')).map((column) => column.name)).toEqual(['x', 'y']);
    });

    it('rolls a failed migration back completely and keeps the previous version', async () => {
        const db = track(new sqlite3.Database(':memory:'));
        await runMigrations(db, [{ version: 1, sql: 'CREATE TABLE a (x INTEGER);' }]);

        await expect(
            runMigrations(db, [
                { version: 1, sql: 'CREATE TABLE a (x INTEGER);' },
                { version: 2, sql: 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;' },
            ]),
        ).rejects.toThrow(/Migration 2 failed/);

        expect(await version(db)).toBe(1);
        expect(await tableNames(db)).not.toContain('b');
    });

    it('refuses a database from a newer app version', async () => {
        const db = track(new sqlite3.Database(':memory:'));
        await new Promise<void>((resolve, reject) => db.exec('PRAGMA user_version = 99', (error) => (error ? reject(error) : resolve())));
        await expect(runMigrations(db, loadMigrations())).rejects.toThrow(/newer version of Velto/);
    });

    it('rejects migrations with gaps', async () => {
        const db = track(new sqlite3.Database(':memory:'));
        await expect(runMigrations(db, [{ version: 2, sql: 'SELECT 1;' }])).rejects.toThrow(/without gaps/);
    });
});
