import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
import { createCategory } from '../src/database/organizerRepository.js';
import {
    buildMatchQuery,
    createEntry,
    deleteEntry,
    deleteEntries,
    duplicateEntry,
    getEntryById,
    listEntries,
    listTags,
    recordUse,
    run,
    searchEntries,
    setArchived,
    setSyntaxLanguage,
    toggleFavorite,
    updateEntry,
} from '../src/database/entryRepository.js';

const open: sqlite3.Database[] = [];

async function createDatabase(): Promise<sqlite3.Database> {
    const db = await openTestDatabase();
    open.push(db);
    return db;
}

afterEach(() => {
    for (const db of open.splice(0)) {
        db.close();
    }
});

describe('entry CRUD', () => {
    it('creates, reads, lists and preserves content exactly', async () => {
        const db = await createDatabase();
        const content = 'Line 1\r\n\r\n  indented  \n%name%\n';
        const created = await createEntry(db, { title: 'Greeting', content, tags: ['Support', 'support', ' ops '] });

        expect(created.content).toBe(content);
        expect(created.syntax_language).toBe('plaintext');
        expect(created.tags).toEqual(['ops', 'Support']);
        expect((await getEntryById(db, created.id)).content).toBe(content);
        expect((await listEntries(db)).rows).toHaveLength(1);
    });

    it('rejects invalid input', async () => {
        const db = await createDatabase();
        await expect(createEntry(db, { title: '   ', content: 'x' })).rejects.toThrow();
        expect((await listEntries(db)).rows).toHaveLength(0);
    });

    it('updates fields and replaces tags', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'A', content: 'one', tags: ['x', 'y'] });
        const updated = await updateEntry(db, { id: created.id, title: 'B', content: 'two', tags: ['z'] });

        expect(updated.title).toBe('B');
        expect(updated.tags).toEqual(['z']);
        expect(await listTags(db)).toEqual(['z']);
    });

    it('persists and updates the syntax language', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'Snippet', content: 'const value = 1;', syntax_language: 'typescript' });
        expect(created.syntax_language).toBe('typescript');

        const updated = await updateEntry(db, { ...created, syntax_language: 'javascript' });
        expect(updated.syntax_language).toBe('javascript');
        expect((await getEntryById(db, created.id)).syntax_language).toBe('javascript');
    });

    it('fails to update a missing entry without side effects', async () => {
        const db = await createDatabase();
        await expect(updateEntry(db, { id: 'nope', title: 'A', content: '' })).rejects.toThrow(/not found/);
    });

    it('duplicates, toggles favorite and records usage', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'Original', content: 'body', tags: ['t'], is_favorite: true });

        const copy = await duplicateEntry(db, created.id);
        expect(copy.id).not.toBe(created.id);
        expect(copy.title).toBe('Original (copy)');
        expect(copy.is_favorite).toBe(false);
        expect(copy.tags).toEqual(['t']);

        expect((await toggleFavorite(db, created.id)).is_favorite).toBe(false);

        await recordUse(db, created.id);
        await recordUse(db, created.id);
        const used = await getEntryById(db, created.id);
        expect(used.use_count).toBe(2);
        expect(used.last_used_at).toBeDefined();
    });

    it('changes archive and syntax without changing edit time, order or other fields', async () => {
        const db = await createDatabase();
        const older = await createEntry(db, { title: 'Older', content: 'hello %name%', tags: ['keep'], is_template: true });
        const newer = await createEntry(db, { title: 'Newer', content: 'newer' });
        await run(db, 'UPDATE entries SET updated_at = ? WHERE id = ?', ['2020-01-01', older.id]);
        await run(db, 'UPDATE entries SET updated_at = ? WHERE id = ?', ['2021-01-01', newer.id]);

        const archived = await setArchived(db, older.id, true);
        expect(archived.is_archived).toBe(true);
        expect(archived.updated_at).toBe('2020-01-01');
        expect((await searchEntries(db, 'hello', { view: 'archived' })).rows[0].entry.id).toBe(older.id);
        expect((await setArchived(db, older.id, false)).is_archived).toBe(false);
        const changed = await setSyntaxLanguage(db, older.id, 'typescript');
        expect(changed.updated_at).toBe('2020-01-01');
        expect(changed.syntax_language).toBe('typescript');
        expect(changed.tags).toEqual(['keep']);
        expect(changed.content).toBe(older.content);
        expect((await listEntries(db)).rows.map((entry) => entry.id)).toEqual([newer.id, older.id]);
        await expect(setArchived(db, 'missing', true)).rejects.toThrow(/not found/);
        await expect(setSyntaxLanguage(db, 'missing', 'sql')).rejects.toThrow(/not found/);
    });

    it('deletes entries and removes them from search', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'Gone', content: 'vanishing text', tags: ['a'] });
        expect((await searchEntries(db, 'vanishing')).rows).toHaveLength(1);

        await deleteEntry(db, created.id);
        expect((await listEntries(db)).rows).toHaveLength(0);
        expect((await searchEntries(db, 'vanishing')).rows).toHaveLength(0);
        expect(await listTags(db)).toEqual([]);
    });

    it('deletes multiple entries atomically and removes their related data', async () => {
        const db = await createDatabase();
        const first = await createEntry(db, { title: 'First', content: 'batch alpha', tags: ['shared'], is_template: true });
        const second = await createEntry(db, { title: 'Second', content: 'batch beta', tags: ['shared'] });
        const keep = await createEntry(db, { title: 'Keep', content: 'leave this', tags: ['shared'] });

        await deleteEntries(db, [first.id, second.id]);

        expect((await listEntries(db)).rows.map((entry) => entry.id)).toEqual([keep.id]);
        expect((await searchEntries(db, 'batch')).rows).toHaveLength(0);
        expect((await searchEntries(db, 'leave')).rows).toHaveLength(1);
        expect(await listTags(db)).toEqual(['shared']);
    });
});

describe('filters', () => {
    it('filters by favorites, recent, archived and tag', async () => {
        const db = await createDatabase();
        const a = await createEntry(db, { title: 'A', content: 'a', tags: ['red'], is_favorite: true });
        await createEntry(db, { title: 'B', content: 'b', tags: ['blue'] });
        const c = await createEntry(db, { title: 'C', content: 'c', is_archived: true });
        await recordUse(db, a.id);

        expect((await listEntries(db, { view: 'all' })).rows.map((e) => e.title).sort()).toEqual(['A', 'B']);
        expect((await listEntries(db, { view: 'favorites' })).rows.map((e) => e.title)).toEqual(['A']);
        expect((await listEntries(db, { view: 'recent' })).rows.map((e) => e.title)).toEqual(['A']);
        expect((await listEntries(db, { view: 'archived' })).rows.map((e) => e.id)).toEqual([c.id]);
        expect((await listEntries(db, { view: 'all', tag: 'BLUE' })).rows.map((e) => e.title)).toEqual(['B']);
    });
});

describe('full-text search', () => {
    it('searches only archived entries in the archived view', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Active', content: 'shared' });
        const archived = await createEntry(db, { title: 'Archived', content: 'shared', is_archived: true });
        expect((await searchEntries(db, 'shared', { view: 'archived' })).rows.map((hit) => hit.entry.id)).toEqual([archived.id]);
    });

    it('keeps search within the selected tag', async () => {
        const db = await createDatabase();
        const tagged = await createEntry(db, { title: 'Tagged', content: 'shared', tags: ['Red'] });
        await createEntry(db, { title: 'Other', content: 'shared', tags: ['blue'] });
        expect((await searchEntries(db, 'shared', { view: 'all', tag: 'red' })).rows.map((hit) => hit.entry.id)).toEqual([tagged.id]);
    });

    it('keeps search within the selected category', async () => {
        const db = await createDatabase();
        const category = await createCategory(db, 'Sales');
        const selected = await createEntry(db, { title: 'Selected', content: 'shared', category_id: category.id });
        await createEntry(db, { title: 'Other', content: 'shared' });
        expect((await searchEntries(db, 'shared', { view: 'all', category_id: category.id })).rows.map((hit) => hit.entry.id)).toEqual([selected.id]);
    });

    it('applies favorites and recent filters when searching', async () => {
        const db = await createDatabase();
        const favorite = await createEntry(db, { title: 'Favorite', content: 'shared', is_favorite: true });
        const recent = await createEntry(db, { title: 'Recent', content: 'shared' });
        await recordUse(db, recent.id);
        expect((await searchEntries(db, 'shared', { view: 'favorites' })).rows.map((hit) => hit.entry.id)).toEqual([favorite.id]);
        expect((await searchEntries(db, 'shared', { view: 'recent' })).rows.map((hit) => hit.entry.id)).toEqual([recent.id]);
    });

    it('finds a word anywhere in the content', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Unrelated title', content: 'First paragraph.\n\nThe refund was processed on Friday.' });
        const { rows: results } = await searchEntries(db, 'refund');
        expect(results).toHaveLength(1);
        expect(results[0].entry.title).toBe('Unrelated title');
    });

    describe('result limits', () => {
        it('reports truncation only when matching rows exceed each limit', async () => {
            const db = await createDatabase();
            await run(db, `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5000)
                INSERT INTO entries (id, title, content, created_at, updated_at)
                SELECT CAST(n AS TEXT), 'Entry', CASE WHEN n <= 50 THEN 'needle' ELSE 'other' END, '2020', '2020' FROM seq`);
            await run(db, `INSERT INTO entries_fts (rowid, title, content)
                SELECT rowid, title, content FROM entries`);

            expect(await listEntries(db)).toMatchObject({ rows: expect.any(Array), truncated: false });
            expect((await listEntries(db)).rows).toHaveLength(5000);
            expect((await searchEntries(db, 'needle')).truncated).toBe(false);
            expect((await searchEntries(db, 'needle')).rows).toHaveLength(50);

            await run(db, "INSERT INTO entries (id, title, content, created_at, updated_at) VALUES ('extra', 'Entry', 'needle', '2021', '2021')");
            await run(db, "INSERT INTO entries_fts (rowid, title, content) SELECT rowid, title, content FROM entries WHERE id = 'extra'");
            const listed = await listEntries(db);
            const searched = await searchEntries(db, 'needle');
            expect(listed.rows).toHaveLength(5000);
            expect(listed.truncated).toBe(true);
            expect(searched.rows).toHaveLength(50);
            expect(searched.truncated).toBe(true);
            expect(await searchEntries(db, '!!!')).toEqual({ rows: [], truncated: false });
            expect((await searchEntries(db, 'needle', { view: 'archived' })).truncated).toBe(false);
        });
    });

    it('matches tags, descriptions and prefixes', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'One', content: 'x', tags: ['onboarding'] });
        await createEntry(db, { title: 'Two', content: 'y', description: 'sent after cancellation' });
        expect((await searchEntries(db, 'onboard')).rows.map((r) => r.entry.title)).toEqual(['One']);
        expect((await searchEntries(db, 'cancellation')).rows.map((r) => r.entry.title)).toEqual(['Two']);
    });

    it('keeps the index in sync after updates', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'T', content: 'alpha', tags: ['beta'] });
        await updateEntry(db, { id: created.id, title: 'T', content: 'gamma', tags: ['delta'] });

        expect((await searchEntries(db, 'alpha')).rows).toHaveLength(0);
        expect((await searchEntries(db, 'beta')).rows).toHaveLength(0);
        expect((await searchEntries(db, 'gamma')).rows).toHaveLength(1);
        expect((await searchEntries(db, 'delta')).rows).toHaveLength(1);
    });

    it('ranks title matches above body matches', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Other', content: 'mentions invoice once' });
        await createEntry(db, { title: 'Invoice reminder', content: 'pay up' });
        const { rows: results } = await searchEntries(db, 'invoice');
        expect(results.map((r) => r.entry.title)).toEqual(['Invoice reminder', 'Other']);
    });

    it('excludes archived entries', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Old', content: 'findme', is_archived: true });
        expect((await searchEntries(db, 'findme')).rows).toHaveLength(0);
    });

    it('handles empty and hostile queries without throwing', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Quote', content: 'say "hello" (world) * OR NOT' });
        for (const query of ['', '   ', '"', '(', '*', 'OR', 'NOT', 'a AND', '"unterminated', '%$#@!', "'; DROP TABLE entries;--"]) {
            expect((await searchEntries(db, query)).rows).toBeInstanceOf(Array);
        }
        expect((await searchEntries(db, '"hello" (world)')).rows).toHaveLength(1);
        expect((await listEntries(db)).rows).toHaveLength(1);
    });

    it('builds a safe match query', () => {
        expect(buildMatchQuery('foo "bar" -baz*')).toBe('"foo"* "bar"* "baz"*');
        expect(buildMatchQuery('!!!')).toBeNull();
    });
});
