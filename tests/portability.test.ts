import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
import { all, createEntry, getEntryById, listEntries, listTags, searchEntries, updateEntry } from '../src/database/entryRepository.js';
import { applyImport, buildLibraryFile, previewImport } from '../src/database/portability.js';
import { LibraryFileSchema, type LibraryFile } from '../src/shared/portability.js';

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

async function seed(db: sqlite3.Database) {
    const a = await createEntry(db, { title: 'Refund processed', content: 'Hello %name%, your refund is on its way.', tags: ['billing', 'Support'], is_template: true, is_favorite: true });
    const b = await createEntry(db, { title: 'Meeting move', content: 'Can we meet later?', tags: ['scheduling'], is_archived: true });
    return { a, b };
}

function roundTrip(file: unknown): LibraryFile {
    return LibraryFileSchema.parse(JSON.parse(JSON.stringify(file)));
}

describe('library export and import', () => {
    it('exports every entry, including archived, with tags and flags', async () => {
        const db = await createDatabase();
        const { a } = await seed(db);
        const file = await buildLibraryFile(db, '1.0.0');

        expect(file.format).toBe('velto-library');
        expect(file.entries).toHaveLength(2);
        const exported = file.entries.find((entry) => entry.id === a.id)!;
        expect(exported.tags.sort()).toEqual(['Support', 'billing']);
        expect(exported.is_template).toBe(true);
        expect(exported.is_favorite).toBe(true);
        expect(exported.syntax_language).toBe('plaintext');
        expect(file.entries.some((entry) => entry.is_archived)).toBe(true);
    });

    it('round-trips into an empty library with ids, timestamps, tags and search intact', async () => {
        const source = await createDatabase();
        const { a } = await seed(source);
        const file = roundTrip(await buildLibraryFile(source));

        const target = await createDatabase();
        const preview = await previewImport(target, file, 'lib.velto');
        expect(preview).toMatchObject({ total: 2, added: 2, changed: 0, identical: 0 });

        const result = await applyImport(target, file, 'merge');
        expect(result).toMatchObject({ added: 2, updated: 0, skipped: 0 });

        const copy = await getEntryById(target, a.id);
        expect(copy).toMatchObject({ title: a.title, content: a.content, created_at: a.created_at, updated_at: a.updated_at, is_template: true });
        expect([...copy.tags].sort()).toEqual(['Support', 'billing']);
        expect((await searchEntries(target, 'refund')).rows.map((hit) => hit.entry.id)).toEqual([a.id]);
        expect(await listTags(target)).toEqual(['billing', 'Support']);
    });

    it('round-trips the selected syntax language and defaults older entries to plaintext', async () => {
        const source = await createDatabase();
        const created = await createEntry(source, { title: 'Code', content: 'const answer: number = 42;', syntax_language: 'typescript' });
        const file = roundTrip(await buildLibraryFile(source));
        expect(file.entries[0].syntax_language).toBe('typescript');

        const target = await createDatabase();
        await applyImport(target, file, 'merge');
        expect((await getEntryById(target, created.id)).syntax_language).toBe('typescript');

        const legacy = roundTrip({
            ...file,
            version: 3,
            entries: file.entries.map(({ syntax_language: _language, ...entry }) => entry),
        });
        const oldTarget = await createDatabase();
        await applyImport(oldTarget, legacy, 'merge');
        expect((await getEntryById(oldTarget, created.id)).syntax_language).toBe('plaintext');
    });

    it('is idempotent: importing the same file twice changes nothing', async () => {
        const source = await createDatabase();
        await seed(source);
        const file = roundTrip(await buildLibraryFile(source));

        const target = await createDatabase();
        await applyImport(target, file, 'merge');
        const second = await applyImport(target, file, 'merge');

        expect(second).toMatchObject({ added: 0, updated: 0, skipped: 2 });
        expect((await previewImport(target, file, 'lib.velto')).identical).toBe(2);
        expect((await listEntries(target, { view: 'all' })).rows).toHaveLength(1);
    });

    it('merge updates entries that are older locally and keeps entries that are newer locally', async () => {
        const source = await createDatabase();
        const { a, b } = await seed(source);
        await updateEntry(source, { id: a.id, title: 'Refund processed v2', content: a.content, tags: a.tags, is_template: true });
        const file = roundTrip(await buildLibraryFile(source));

        const target = await createDatabase();
        const seeded = roundTrip(await buildLibraryFile(source));
        seeded.entries = seeded.entries.map((entry) => (entry.id === a.id ? { ...entry, title: 'Refund processed', updated_at: '2000-01-01T00:00:00.000Z' } : entry));
        await applyImport(target, seeded, 'merge');
        await updateEntry(target, { id: b.id, title: 'Meeting move (local edit)', content: b.content, tags: b.tags, is_archived: true });

        const preview = await previewImport(target, file, 'lib.velto');
        expect(preview).toMatchObject({ changed: 1, newerLocally: 1, added: 0 });

        const result = await applyImport(target, file, 'merge');
        expect(result).toMatchObject({ added: 0, updated: 1, skipped: 1 });
        expect((await getEntryById(target, a.id)).title).toBe('Refund processed v2');
        expect((await getEntryById(target, b.id)).title).toBe('Meeting move (local edit)');
        expect((await searchEntries(target, 'v2')).rows).toHaveLength(1);
    });

    it('removes orphaned tags when a merge overwrites an entry', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, { title: 'Original', content: 'body', tags: ['old', 'shared'] });
        await createEntry(db, { title: 'Other', content: 'body', tags: ['shared'], is_archived: true });
        const file = roundTrip(await buildLibraryFile(db));
        file.entries = file.entries.filter((item) => item.id === entry.id).map((item) => ({
            ...item, title: 'Updated', tags: ['new'], updated_at: '2100-01-01T00:00:00.000Z',
        }));
        expect((await applyImport(db, file, 'merge')).updated).toBe(1);
        expect((await all(db, 'SELECT name FROM tags ORDER BY name')).map((row) => row.name)).toEqual(['new', 'shared']);
        expect((await getEntryById(db, entry.id)).tags).toEqual(['new']);
    });

    it('duplicate mode adds copies with new ids', async () => {
        const db = await createDatabase();
        await seed(db);
        const file = roundTrip(await buildLibraryFile(db));

        const result = await applyImport(db, file, 'duplicate');
        expect(result.added).toBe(2);
        const ids = new Set(roundTrip(await buildLibraryFile(db)).entries.map((entry) => entry.id));
        expect(ids.size).toBe(4);
    });

    it('replace mode swaps the library for the file, including search and tags', async () => {
        const source = await createDatabase();
        await seed(source);
        const file = roundTrip(await buildLibraryFile(source));

        const target = await createDatabase();
        await createEntry(target, { title: 'Local only', content: 'zebra content', tags: ['stripes'] });
        await applyImport(target, file, 'replace');

        const exported = await buildLibraryFile(target);
        expect(exported.entries.map((entry) => entry.title).sort()).toEqual(['Meeting move', 'Refund processed']);
        expect((await searchEntries(target, 'zebra')).rows).toHaveLength(0);
        expect(await listTags(target)).not.toContain('stripes');
    });

    it('rolls back completely when an import fails part-way', async () => {
        const db = await createDatabase();
        await seed(db);
        const file = roundTrip(await buildLibraryFile(db));
        const broken: LibraryFile = { ...file, entries: [...file.entries, { ...file.entries[0], id: 'x', title: null as unknown as string }] };

        await expect(applyImport(db, broken, 'replace')).rejects.toThrow();
        expect((await buildLibraryFile(db)).entries).toHaveLength(2);
    });

    it('keeps the newest copy when a file repeats an id', async () => {
        const source = await createDatabase();
        await seed(source);
        const file = roundTrip(await buildLibraryFile(source));
        const first = file.entries[0];
        file.entries.push({ ...first, title: 'Newer copy', updated_at: '2999-01-01T00:00:00.000Z' });

        const target = await createDatabase();
        await applyImport(target, file, 'merge');
        expect((await getEntryById(target, first.id)).title).toBe('Newer copy');
        expect((await buildLibraryFile(target)).entries).toHaveLength(2);
    });

    it('treats hostile content as plain data', async () => {
        const target = await createDatabase();
        const file = roundTrip({
            format: 'velto-library',
            version: 1,
            categories: [],
            exported_at: new Date().toISOString(),
            entries: [{ id: "x'); DROP TABLE entries;--", title: '<script>alert(1)</script>', content: "'; DROP TABLE entries; --", syntax_language: 'plaintext', tags: ['"quoted"'], variables: [], is_favorite: false, is_template: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), use_count: 0 }],
        });
        await applyImport(target, file, 'merge');
        const entries = (await buildLibraryFile(target)).entries;
        expect(entries).toHaveLength(1);
        expect(entries[0].content).toBe("'; DROP TABLE entries; --");
    });
});

describe('library file validation', () => {
    const base = { format: 'velto-library', version: 1, exported_at: '2026-01-01T00:00:00.000Z', entries: [] };

    it('accepts a minimal valid file', () => {
        expect(LibraryFileSchema.safeParse(base).success).toBe(true);
    });

    it.each([
        ['wrong format', { ...base, format: 'other' }],
        ['newer version', { ...base, version: 6 }],
        ['missing entries', { format: base.format, version: 1, exported_at: base.exported_at }],
        ['bad timestamp', { ...base, exported_at: 'yesterday' }],
        ['empty title', { ...base, entries: [{ id: '1', title: '  ', content: '', created_at: base.exported_at, updated_at: base.exported_at }] }],
        ['non-object', 'nope'],
    ])('rejects %s', (_name, value) => {
        expect(LibraryFileSchema.safeParse(value).success).toBe(false);
    });
});
