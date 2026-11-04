import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
import { createEntry, deleteEntry, duplicateEntry, getEntryById, updateEntry } from '../src/database/entryRepository.js';
import { applyImport, buildLibraryFile } from '../src/database/portability.js';
import { LibraryEntryDraftSchema } from '../src/shared/validators.js';
import { renderWithDefinitions } from '../src/shared/template.js';

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
