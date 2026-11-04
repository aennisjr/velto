import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
import { createEntry, getEntryById, listEntries, searchEntries, updateEntry } from '../src/database/entryRepository.js';
import {
    createCategory,
    deleteCategory,
    deleteTag,
    listCategories,
    listTagUsage,
    renameCategory,
    renameTag,
} from '../src/database/organizerRepository.js';
import { applyImport, buildLibraryFile, previewImport } from '../src/database/portability.js';
import { LibraryFileSchema } from '../src/shared/portability.js';

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

const ids = async (db: sqlite3.Database, query: string) => (await searchEntries(db, query)).map((hit) => hit.entry.id);

describe('categories', () => {
    it('creates, lists with counts, and rejects duplicates and blanks', async () => {
        const db = await createDatabase();
        const billing = await createCategory(db, '  Billing ');
        expect(billing.name).toBe('Billing');
        await createEntry(db, { title: 'A', content: 'a', category_id: billing.id });
        await createEntry(db, { title: 'B', content: 'b', category_id: billing.id, is_archived: true });

        expect(await listCategories(db)).toMatchObject([{ name: 'Billing', count: 1 }]);
        await expect(createCategory(db, 'billing')).rejects.toThrow(/already exists/);
        await expect(createCategory(db, '   ')).rejects.toThrow(/empty/);
    });

    it('filters entries by category', async () => {
        const db = await createDatabase();
        const sales = await createCategory(db, 'Sales');
        const inSales = await createEntry(db, { title: 'Pitch', content: 'x', category_id: sales.id });
        await createEntry(db, { title: 'Other', content: 'y' });

        expect((await listEntries(db, { view: 'all', category_id: sales.id })).map((e) => e.id)).toEqual([inSales.id]);
    });

    it('makes entries searchable by category name, and rename updates search', async () => {
        const db = await createDatabase();
        const category = await createCategory(db, 'Onboarding');
        const entry = await createEntry(db, { title: 'Welcome', content: 'hi', category_id: category.id });
        expect(await ids(db, 'onboarding')).toEqual([entry.id]);

        await renameCategory(db, category.id, 'Getting Started');
        expect(await ids(db, 'onboarding')).toEqual([]);
        expect(await ids(db, 'getting')).toEqual([entry.id]);
        await expect(renameCategory(db, category.id, ' ')).rejects.toThrow();
    });

    it('rejects renaming onto another category', async () => {
        const db = await createDatabase();
        await createCategory(db, 'One');
        const two = await createCategory(db, 'Two');
        await expect(renameCategory(db, two.id, 'one')).rejects.toThrow(/already exists/);
        await renameCategory(db, two.id, 'TWO');
    });

    it('deleting a category keeps its entries, uncategorized, and updates search', async () => {
        const db = await createDatabase();
        const category = await createCategory(db, 'Legacy');
        const entry = await createEntry(db, { title: 'Keep me', content: 'body', category_id: category.id });

        await deleteCategory(db, category.id);
        expect((await getEntryById(db, entry.id)).category_id).toBeUndefined();
        expect(await listCategories(db)).toEqual([]);
        expect(await ids(db, 'legacy')).toEqual([]);
        expect(await ids(db, 'keep')).toEqual([entry.id]);
    });

    it('can change an entry to a different category', async () => {
        const db = await createDatabase();
        const a = await createCategory(db, 'A');
        const b = await createCategory(db, 'B');
        const entry = await createEntry(db, { title: 'Move', content: 'm', category_id: a.id });
        await updateEntry(db, { ...entry, category_id: b.id });
        expect((await getEntryById(db, entry.id)).category_id).toBe(b.id);
    });
});

describe('tag management', () => {
    it('reports usage counts', async () => {
        const db = await createDatabase();
        await createEntry(db, { title: 'A', content: 'a', tags: ['x', 'y'] });
        await createEntry(db, { title: 'B', content: 'b', tags: ['x'] });
        expect(await listTagUsage(db)).toEqual([
            { name: 'x', count: 2 },
            { name: 'y', count: 1 },
        ]);
    });

    it('renames a tag and updates search', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, { title: 'A', content: 'a', tags: ['old'] });
        await renameTag(db, 'old', 'fresh');
        expect((await getEntryById(db, entry.id)).tags).toEqual(['fresh']);
        expect(await ids(db, 'old')).toEqual([]);
        expect(await ids(db, 'fresh')).toEqual([entry.id]);
    });

    it('merges into an existing tag, case-insensitively, without duplicates', async () => {
        const db = await createDatabase();
        const both = await createEntry(db, { title: 'Both', content: 'b', tags: ['a', 'B'] });
        const onlyA = await createEntry(db, { title: 'OnlyA', content: 'o', tags: ['a'] });

        await renameTag(db, 'a', 'b');
        expect((await getEntryById(db, both.id)).tags).toEqual(['B']);
        expect((await getEntryById(db, onlyA.id)).tags).toEqual(['B']);
        expect(await listTagUsage(db)).toEqual([{ name: 'B', count: 2 }]);
    });

    it('deletes a tag from every entry', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, { title: 'A', content: 'a', tags: ['gone', 'stay'] });
        await deleteTag(db, 'gone');
        expect((await getEntryById(db, entry.id)).tags).toEqual(['stay']);
        expect(await ids(db, 'gone')).toEqual([]);
        await deleteTag(db, 'never-existed');
    });

    it('errors when renaming a tag that does not exist', async () => {
        const db = await createDatabase();
        await expect(renameTag(db, 'nope', 'x')).rejects.toThrow(/not found/);
    });
});

describe('categories in export and import', () => {
    async function source() {
        const db = await createDatabase();
        const sales = await createCategory(db, 'Sales');
        await createCategory(db, 'Empty');
        const entry = await createEntry(db, { title: 'Pitch', content: 'p', category_id: sales.id });
        return { db, entry };
    }

    it('exports category names, including empty categories', async () => {
        const { db, entry } = await source();
        const file = await buildLibraryFile(db);
        expect(file.version).toBe(4);
        expect(file.categories).toEqual(['Empty', 'Sales']);
        expect(file.entries.find((e) => e.id === entry.id)?.category).toBe('Sales');
    });

    it('recreates categories on the target and links entries', async () => {
        const { db, entry } = await source();
        const file = LibraryFileSchema.parse(JSON.parse(JSON.stringify(await buildLibraryFile(db))));
        const target = await createDatabase();
        await createCategory(target, 'sales');
        await applyImport(target, file, 'merge');

        const categories = await listCategories(target);
        expect(categories.map((c) => c.name).sort()).toEqual(['Empty', 'sales']);
        const imported = await getEntryById(target, entry.id);
        expect(imported.category_id).toBe(categories.find((c) => c.name === 'sales')?.id);
        expect(await ids(target, 'sales')).toEqual([entry.id]);
    });

    it('replace removes categories not in the file', async () => {
        const { db } = await source();
        const file = LibraryFileSchema.parse(JSON.parse(JSON.stringify(await buildLibraryFile(db))));
        const target = await createDatabase();
        await createCategory(target, 'Stale');
        await applyImport(target, file, 'replace');
        expect((await listCategories(target)).map((c) => c.name).sort()).toEqual(['Empty', 'Sales']);
    });

    it('detects a category-only change when previewing', async () => {
        const { db, entry } = await source();
        const file = LibraryFileSchema.parse(JSON.parse(JSON.stringify(await buildLibraryFile(db))));
        file.entries[0].category = 'Support';
        file.entries[0].updated_at = '2999-01-01T00:00:00.000Z';
        expect(await previewImport(db, file, 'f.velto')).toMatchObject({ changed: 1, identical: 0 });
        await applyImport(db, file, 'merge');
        const after = await buildLibraryFile(db);
        expect(after.entries.find((e) => e.id === entry.id)?.category).toBe('Support');
    });

    it('still imports version 1 files that have no categories', () => {
        const parsed = LibraryFileSchema.parse({ format: 'velto-library', version: 1, exported_at: '2026-01-01T00:00:00.000Z', entries: [] });
        expect(parsed.categories).toEqual([]);
    });
});
