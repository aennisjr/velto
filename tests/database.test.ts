import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
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
    searchEntries,
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
        expect(await listEntries(db)).toHaveLength(1);
    });

    it('rejects invalid input', async () => {
        const db = await createDatabase();
        await expect(createEntry(db, { title: '   ', content: 'x' })).rejects.toThrow();
        expect(await listEntries(db)).toHaveLength(0);
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

    it('deletes entries and removes them from search', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'Gone', content: 'vanishing text', tags: ['a'] });
        expect(await searchEntries(db, 'vanishing')).toHaveLength(1);

        await deleteEntry(db, created.id);
        expect(await listEntries(db)).toHaveLength(0);
        expect(await searchEntries(db, 'vanishing')).toHaveLength(0);
        expect(await listTags(db)).toEqual([]);
    });

    it('deletes multiple entries atomically and removes their related data', async () => {
        const db = await createDatabase();
        const first = await createEntry(db, { title: 'First', content: 'batch alpha', tags: ['shared'], is_template: true });
        const second = await createEntry(db, { title: 'Second', content: 'batch beta', tags: ['shared'] });
        const keep = await createEntry(db, { title: 'Keep', content: 'leave this', tags: ['shared'] });

        await deleteEntries(db, [first.id, second.id]);

        expect((await listEntries(db)).map((entry) => entry.id)).toEqual([keep.id]);
        expect(await searchEntries(db, 'batch')).toHaveLength(0);
        expect(await searchEntries(db, 'leave')).toHaveLength(1);
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

        expect((await listEntries(db, { view: 'all' })).map((e) => e.title).sort()).toEqual(['A', 'B']);
        expect((await listEntries(db, { view: 'favorites' })).map((e) => e.title)).toEqual(['A']);
        expect((await listEntries(db, { view: 'recent' })).map((e) => e.title)).toEqual(['A']);
        expect((await listEntries(db, { view: 'archived' })).map((e) => e.id)).toEqual([c.id]);
        expect((await listEntries(db, { view: 'all', tag: 'BLUE' })).map((e) => e.title)).toEqual(['B']);
    });
});

describe('full-text search', () => {
    it('finds a word anywhere in the content', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Unrelated title', content: 'First paragraph.\n\nThe refund was processed on Friday.' });
        const results = await searchEntries(db, 'refund');
        expect(results).toHaveLength(1);
        expect(results[0].entry.title).toBe('Unrelated title');
    });

    it('matches tags, descriptions and prefixes', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'One', content: 'x', tags: ['onboarding'] });
        await createEntry(db, { title: 'Two', content: 'y', description: 'sent after cancellation' });
        expect((await searchEntries(db, 'onboard')).map((r) => r.entry.title)).toEqual(['One']);
        expect((await searchEntries(db, 'cancellation')).map((r) => r.entry.title)).toEqual(['Two']);
    });

    it('keeps the index in sync after updates', async () => {
        const db = await createDatabase();
        const created = await createEntry(db, { title: 'T', content: 'alpha', tags: ['beta'] });
        await updateEntry(db, { id: created.id, title: 'T', content: 'gamma', tags: ['delta'] });

        expect(await searchEntries(db, 'alpha')).toHaveLength(0);
        expect(await searchEntries(db, 'beta')).toHaveLength(0);
        expect(await searchEntries(db, 'gamma')).toHaveLength(1);
        expect(await searchEntries(db, 'delta')).toHaveLength(1);
    });

    it('ranks title matches above body matches', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Other', content: 'mentions invoice once' });
        await createEntry(db, { title: 'Invoice reminder', content: 'pay up' });
        const results = await searchEntries(db, 'invoice');
        expect(results.map((r) => r.entry.title)).toEqual(['Invoice reminder', 'Other']);
    });

    it('excludes archived entries', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Old', content: 'findme', is_archived: true });
        expect(await searchEntries(db, 'findme')).toHaveLength(0);
    });

    it('handles empty and hostile queries without throwing', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'Quote', content: 'say "hello" (world) * OR NOT' });
        for (const query of ['', '   ', '"', '(', '*', 'OR', 'NOT', 'a AND', '"unterminated', '%$#@!', "'; DROP TABLE entries;--"]) {
            await expect(searchEntries(db, query)).resolves.toBeInstanceOf(Array);
        }
        expect(await searchEntries(db, '"hello" (world)')).toHaveLength(1);
        expect(await listEntries(db)).toHaveLength(1);
    });

    it('builds a safe match query', () => {
        expect(buildMatchQuery('foo "bar" -baz*')).toBe('"foo"* "bar"* "baz"*');
        expect(buildMatchQuery('!!!')).toBeNull();
    });
});
