import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite3';
import {
    LIBRARY_FORMAT,
    LIBRARY_FORMAT_VERSION,
    type ExportedEntry,
    type ImportMode,
    type ImportPreview,
    type ImportResult,
    type LibraryFile,
} from '../shared/portability.js';
import { all, get, loadVariables, reindex, run, setTags, setVariables, transaction } from './entryRepository.js';
import { EntryFieldsSchema } from '../shared/validators.js';

function tagKey(tags: string[]): string {
    return tags.map((tag) => tag.toLowerCase()).sort().join('\u0000');
}

function variableKey(variables: ExportedEntry['variables']): string {
    return JSON.stringify(variables.map((variable) => [variable.name, variable.label ?? '', variable.default_value ?? '', variable.required, variable.field_type, variable.options ?? []]));
}

function sameContent(a: ExportedEntry, b: ExportedEntry): boolean {
    return (
        a.title === b.title &&
        a.content === b.content &&
        JSON.stringify(a.fields) === JSON.stringify(b.fields) &&
        a.syntax_language === b.syntax_language &&
        (a.description ?? '') === (b.description ?? '') &&
        (a.category ?? '').toLowerCase() === (b.category ?? '').toLowerCase() &&
        a.is_favorite === b.is_favorite &&
        a.is_template === b.is_template &&
        a.is_archived === b.is_archived &&
        tagKey(a.tags) === tagKey(b.tags) &&
        variableKey(a.variables) === variableKey(b.variables)
    );
}

async function loadAll(db: Database): Promise<ExportedEntry[]> {
    const rows = await all(
        db,
        'SELECT e.*, c.name AS category_name FROM entries e LEFT JOIN categories c ON c.id = e.category_id ORDER BY e.created_at',
    );
    const tagRows = await all(
        db,
        'SELECT et.entry_id AS entry_id, t.name AS name FROM entry_tags et JOIN tags t ON t.id = et.tag_id ORDER BY t.name COLLATE NOCASE',
    );
    const variables = await loadVariables(db, rows.map((row) => String(row.id)));
    const tags = new Map<string, string[]>();
    for (const row of tagRows) {
        const key = String(row.entry_id);
        tags.set(key, [...(tags.get(key) ?? []), String(row.name)]);
    }

    return rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        content: String(row.content),
        fields: EntryFieldsSchema.parse(JSON.parse(String(row.fields))),
        syntax_language: String(row.syntax_language ?? 'plaintext') as ExportedEntry['syntax_language'],
        description: row.description == null || row.description === '' ? undefined : String(row.description),
        category: row.category_name == null ? undefined : String(row.category_name),
        tags: tags.get(String(row.id)) ?? [],
        variables: variables.get(String(row.id)) ?? [],
        is_favorite: Boolean(row.is_favorite),
        is_template: Boolean(row.is_template),
        is_archived: Boolean(row.is_archived),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        last_used_at: row.last_used_at == null ? undefined : String(row.last_used_at),
        use_count: Number(row.use_count ?? 0),
    }));
}

export async function buildLibraryFile(db: Database, appVersion?: string): Promise<LibraryFile> {
    return {
        format: LIBRARY_FORMAT,
        version: LIBRARY_FORMAT_VERSION,
        exported_at: new Date().toISOString(),
        app_version: appVersion,
        categories: (await all(db, 'SELECT name FROM categories ORDER BY name COLLATE NOCASE')).map((row) => String(row.name)),
        entries: await loadAll(db),
    };
}

// When a file repeats an id, the most recently updated copy wins.
function dedupe(entries: ExportedEntry[]): ExportedEntry[] {
    const byId = new Map<string, ExportedEntry>();
    for (const entry of entries) {
        const current = byId.get(entry.id);
        if (!current || Date.parse(entry.updated_at) >= Date.parse(current.updated_at)) {
            byId.set(entry.id, entry);
        }
    }
    return [...byId.values()];
}

export async function previewImport(db: Database, file: LibraryFile, fileName: string): Promise<ImportPreview> {
    const local = new Map((await loadAll(db)).map((entry) => [entry.id, entry]));
    const incoming = dedupe(file.entries);
    const preview: ImportPreview = {
        fileName,
        exportedAt: file.exported_at,
        total: incoming.length,
        added: 0,
        changed: 0,
        identical: 0,
        newerLocally: 0,
    };

    for (const entry of incoming) {
        const existing = local.get(entry.id);
        if (!existing) {
            preview.added += 1;
        } else if (sameContent(existing, entry)) {
            preview.identical += 1;
        } else if (Date.parse(entry.updated_at) > Date.parse(existing.updated_at)) {
            preview.changed += 1;
        } else {
            preview.newerLocally += 1;
        }
    }
    return preview;
}

type CategoryResolver = (name: string | undefined) => Promise<string | null>;

// Categories travel by name, so import finds an existing one (case-insensitive) or creates it.
function categoryResolver(db: Database): CategoryResolver {
    const cache = new Map<string, string>();
    return async (name) => {
        if (!name) {
            return null;
        }
        const key = name.toLowerCase();
        const cached = cache.get(key);
        if (cached) {
            return cached;
        }
        const existing = await get(db, 'SELECT id FROM categories WHERE name = ? COLLATE NOCASE', [name]);
        const id = existing ? String(existing.id) : randomUUID();
        if (!existing) {
            await run(db, 'INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)', [id, name, new Date().toISOString()]);
        }
        cache.set(key, id);
        return id;
    };
}

async function insertEntry(db: Database, entry: ExportedEntry, id: string, resolve: CategoryResolver): Promise<void> {
    await run(
        db,
        `INSERT INTO entries (id, title, content, fields, syntax_language, description, category_id, is_favorite, is_template, is_archived, created_at, updated_at, last_used_at, use_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, entry.title, entry.content, JSON.stringify(entry.fields), entry.syntax_language, entry.description ?? null, await resolve(entry.category), Number(entry.is_favorite), Number(entry.is_template), Number(entry.is_archived), entry.created_at, entry.updated_at, entry.last_used_at ?? null, entry.use_count],
    );
    await setTags(db, id, entry.tags);
    await setVariables(db, id, entry.content, entry.fields, entry.variables);
    await reindex(db, id);
}

async function overwriteEntry(db: Database, entry: ExportedEntry, resolve: CategoryResolver): Promise<void> {
    await run(
        db,
        `UPDATE entries SET title = ?, content = ?, fields = ?, syntax_language = ?, description = ?, category_id = ?, is_favorite = ?, is_template = ?, is_archived = ?,
         created_at = ?, updated_at = ?, last_used_at = COALESCE(?, last_used_at), use_count = MAX(use_count, ?)
         WHERE id = ?`,
        [entry.title, entry.content, JSON.stringify(entry.fields), entry.syntax_language, entry.description ?? null, await resolve(entry.category), Number(entry.is_favorite), Number(entry.is_template), Number(entry.is_archived), entry.created_at, entry.updated_at, entry.last_used_at ?? null, entry.use_count, entry.id],
    );
    await setTags(db, entry.id, entry.tags);
    await setVariables(db, entry.id, entry.content, entry.fields, entry.variables);
    await reindex(db, entry.id);
}

async function clearLibrary(db: Database): Promise<void> {
    await run(db, 'DELETE FROM entries_fts');
    await run(db, 'DELETE FROM template_variables');
    await run(db, 'DELETE FROM entry_tags');
    await run(db, 'DELETE FROM entries');
    await run(db, 'DELETE FROM tags');
    await run(db, 'DELETE FROM categories');
}

export function applyImport(db: Database, file: LibraryFile, mode: ImportMode): Promise<ImportResult> {
    const incoming = dedupe(file.entries);

    return transaction(db, async () => {
        const result: ImportResult = { added: 0, updated: 0, skipped: 0 };

        if (mode === 'replace') {
            await clearLibrary(db);
        }

        const resolve = categoryResolver(db);
        for (const name of file.categories) {
            await resolve(name);
        }

        const local = new Map((mode === 'merge' ? await loadAll(db) : []).map((entry) => [entry.id, entry]));

        for (const entry of incoming) {
            if (mode === 'duplicate') {
                await insertEntry(db, entry, randomUUID(), resolve);
                result.added += 1;
                continue;
            }

            const existing = local.get(entry.id);
            if (!existing) {
                await insertEntry(db, entry, entry.id, resolve);
                result.added += 1;
            } else if (!sameContent(existing, entry) && Date.parse(entry.updated_at) > Date.parse(existing.updated_at)) {
                await overwriteEntry(db, entry, resolve);
                result.updated += 1;
            } else {
                result.skipped += 1;
            }
        }
        return result;
    });
}
