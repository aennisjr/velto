import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
import { createEntry, deleteEntry, duplicateEntry, getEntryById, searchEntries, updateEntry } from '../src/database/entryRepository.js';
import { applyImport, buildLibraryFile, previewImport } from '../src/database/portability.js';
import { LibraryFileSchema } from '../src/shared/portability.js';
import { LibraryEntryDraftSchema } from '../src/shared/validators.js';
import { entryVariableNames, renderWithDefinitions } from '../src/shared/template.js';

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

describe('additional entry fields', () => {
    it('stores, searches, updates and duplicates fields and their variable definitions', async () => {
        const db = await createDatabase();
        const fields = [{ label: 'Subject', value: 'Invoice for %name% %account%' }, { label: 'Code', value: 'uniquevalue' }];
        const entry = await createEntry(db, {
            title: 'Email', content: 'Hello %name%', is_template: true, fields,
            variables: [{ name: 'name', label: 'Customer' }, { name: 'account', default_value: 'A1' }],
        });
        expect(entry.fields).toEqual(fields);
        expect(entry.variables.map((variable) => variable.name)).toEqual(['name', 'account']);
        expect((await searchEntries(db, 'subject')).rows.map((hit) => hit.entry.id)).toEqual([entry.id]);
        expect((await searchEntries(db, 'uniquevalue')).rows.map((hit) => hit.entry.id)).toEqual([entry.id]);
        const copy = await duplicateEntry(db, entry.id);
        expect(copy.fields).toEqual(fields);
        expect(copy.variables).toEqual(entry.variables);

        const unchanged = await updateEntry(db, { id: entry.id, title: 'Email', content: 'Hello %name%', is_template: true });
        expect(unchanged.fields).toEqual(fields);
        expect(unchanged.variables.map((variable) => variable.name)).toEqual(['name', 'account']);
        const updated = await updateEntry(db, { ...unchanged, fields: [{ label: 'Topic', value: '%name%' }] });
        expect(updated.variables.map((variable) => variable.name)).toEqual(['name']);
        expect((await searchEntries(db, 'subject')).rows.map((hit) => hit.entry.id)).toEqual([copy.id]);
        expect((await searchEntries(db, 'topic')).rows.map((hit) => hit.entry.id)).toEqual([entry.id]);
    });

    it('round-trips fields, detects field-only changes, and imports older files', async () => {
        const source = await createDatabase();
        const entry = await createEntry(source, { title: 'Email', content: 'body', fields: [{ label: 'Subject', value: '%name%' }], is_template: true });
        const file = LibraryFileSchema.parse(await buildLibraryFile(source));
        const target = await createDatabase();
        await applyImport(target, file, 'merge');
        expect((await getEntryById(target, entry.id)).fields).toEqual(entry.fields);
        const changed = { ...file, entries: file.entries.map((item) => ({ ...item, fields: [{ label: 'Subject', value: 'changed' }], updated_at: '2100-01-01T00:00:00.000Z' })) };
        expect((await previewImport(target, changed, 'library.velto')).changed).toBe(1);
        await applyImport(target, changed, 'merge');
        expect((await searchEntries(target, 'changed')).rows).toHaveLength(1);
        expect((await getEntryById(target, entry.id)).fields[0].value).toBe('changed');

        const old = LibraryFileSchema.parse({ ...file, version: 4, entries: file.entries.map(({ fields: _fields, ...item }) => item) });
        expect(old.entries[0].fields).toEqual([]);
        const legacyTarget = await createDatabase();
        await applyImport(legacyTarget, old, 'replace');
        expect((await getEntryById(legacyTarget, entry.id)).fields).toEqual([]);
    });

    it('preserves fields and search in duplicate and replace imports', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, { title: 'Email', content: 'body', fields: [{ label: 'Subject', value: 'specialtopic' }] });
        const file = LibraryFileSchema.parse(await buildLibraryFile(db));
        await applyImport(db, file, 'duplicate');
        expect((await searchEntries(db, 'specialtopic')).rows).toHaveLength(2);
        const allEntries = (await buildLibraryFile(db)).entries;
        expect(allEntries.every((item) => item.fields[0].value === 'specialtopic')).toBe(true);
        await applyImport(db, file, 'replace');
        expect((await searchEntries(db, 'specialtopic')).rows.map((hit) => hit.entry.id)).toEqual([entry.id]);
        expect((await getEntryById(db, entry.id)).fields).toEqual(entry.fields);
    });

    it('validates field names and limits', () => {
        expect(() => draft({ fields: [{ label: ' ', value: 'x' }] })).toThrow();
        expect(() => draft({ fields: Array.from({ length: 21 }, () => ({ label: 'x', value: '' })) })).toThrow();
        expect(() => draft({ fields: [{ label: 'x', value: 'x'.repeat(10001) }] })).toThrow();
    });

    it('collects shared and field-only placeholders independently', () => {
        const fields = [{ label: 'Subject', value: '%name% %account%' }, { label: 'Code', value: '%account% %more%' }];
        expect(entryVariableNames('%name% %body%', fields)).toEqual(['name', 'body', 'account', 'more']);
        expect(renderWithDefinitions(fields[0].value, [], { name: 'Ada' }).missing).toEqual(['account']);
    });
});

const draft = (overrides: Record<string, unknown> = {}) =>
    LibraryEntryDraftSchema.parse({ title: 'T', content: 'Hi %name%, on %date% pick %plan%', is_template: true, ...overrides });

const definitions = [
    { name: 'name', label: 'Customer', default_value: 'Sam', required: true, field_type: 'text' as const },
    { name: 'date', required: false, field_type: 'date' as const },
    { name: 'plan', required: true, field_type: 'dropdown' as const, options: ['Basic', 'Pro'] },
];

describe('template variable definitions', () => {
    it('stores and returns definitions in order', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, draft({ variables: definitions }));
        expect(entry.variables.map((variable) => variable.name)).toEqual(['name', 'date', 'plan']);
        expect(entry.variables[0]).toMatchObject({ label: 'Customer', default_value: 'Sam', required: true });
        expect(entry.variables[1].required).toBe(false);
        expect(entry.variables[2].options).toEqual(['Basic', 'Pro']);
    });

    it('keeps definitions when none are supplied but prunes removed placeholders', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, draft({ variables: definitions }));
        const kept = await updateEntry(db, { ...draft(), id: entry.id });
        expect(kept.variables).toHaveLength(3);
        const pruned = await updateEntry(db, { ...draft({ content: 'Only %name%' }), id: entry.id });
        expect(pruned.variables.map((variable) => variable.name)).toEqual(['name']);
    });

    it('replaces definitions when supplied and ignores unknown or duplicate names', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, draft({ variables: definitions }));
        const updated = await updateEntry(db, {
            ...draft({ variables: [{ name: 'name', required: false }, { name: 'name', required: true }, { name: 'ghost' }] }),
            id: entry.id,
        });
        expect(updated.variables).toHaveLength(1);
        expect(updated.variables[0].required).toBe(false);
    });

    it('rejects a dropdown without options', () => {
        expect(() => draft({ variables: [{ name: 'plan', field_type: 'dropdown' }] })).toThrow();
    });

    it('copies definitions on duplicate and removes them on delete', async () => {
        const db = await createDatabase();
        const entry = await createEntry(db, draft({ variables: definitions }));
        const copy = await duplicateEntry(db, entry.id);
        expect(copy.variables).toHaveLength(3);
        await deleteEntry(db, entry.id);
        expect((await getEntryById(db, copy.id)).variables).toHaveLength(3);
    });

    it('round-trips through export and import', async () => {
        const source = await createDatabase();
        await createEntry(source, draft({ variables: definitions }));
        const file = JSON.parse(JSON.stringify(await buildLibraryFile(source)));
        const target = await createDatabase();
        await applyImport(target, file, 'merge');
        const imported = (await buildLibraryFile(target)).entries[0];
        expect(imported.variables).toEqual((await buildLibraryFile(source)).entries[0].variables);
    });
});

describe('renderWithDefinitions', () => {
    const entry = { content: 'Hi %name% %date%', variables: definitions.slice(0, 2).map((variable) => ({ ...variable })) };

    it('uses defaults, allows optional blanks and blocks required blanks', () => {
        expect(renderWithDefinitions(entry.content, entry.variables, {})).toEqual({ text: 'Hi Sam ', missing: [] });
        const cleared = renderWithDefinitions(entry.content, entry.variables, { name: '' });
        expect(cleared.missing).toEqual(['name']);
    });

    it('treats undefined variables as required', () => {
        expect(renderWithDefinitions('%x%', [], {}).missing).toEqual(['x']);
    });
});
