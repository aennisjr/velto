import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite3';
import type { EntryField, EntryResults, LibraryEntry, ListFilter, SearchResult, TemplateVariable } from '../shared/types.js';
import type { SyntaxLanguage } from '../shared/syntaxLanguages.js';
import { entryVariableNames } from '../shared/template.js';
import { EntryFieldsSchema, LibraryEntryDraftSchema, type LibraryEntryDraft } from '../shared/validators.js';

type Row = Record<string, unknown>;

export function all(db: Database, sql: string, params: unknown[] = []): Promise<Row[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows as Row[])));
    });
}

export function get(db: Database, sql: string, params: unknown[] = []): Promise<Row | undefined> {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row as Row | undefined)));
    });
}

export function run(db: Database, sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (error) => (error ? reject(error) : resolve()));
    });
}

// A single connection cannot interleave transactions, so writes are queued per database.
const queues = new WeakMap<Database, Promise<unknown>>();

export function transaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(db) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
        await run(db, 'BEGIN IMMEDIATE');
        try {
            const result = await work();
            await run(db, 'COMMIT');
            return result;
        } catch (error) {
            await run(db, 'ROLLBACK');
            throw error;
        }
    });
    queues.set(db, next);
    return next;
}

function normalizeTags(tags: string[]): string[] {
    const seen = new Map<string, string>();
    for (const tag of tags) {
        const trimmed = tag.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
            seen.set(trimmed.toLowerCase(), trimmed);
        }
    }
    return [...seen.values()];
}

async function loadTags(db: Database, ids: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (ids.length === 0) {
        return result;
    }

    const rows = await all(
        db,
        `SELECT et.entry_id AS entry_id, t.name AS name
         FROM entry_tags et JOIN tags t ON t.id = et.tag_id
         WHERE et.entry_id IN (${ids.map(() => '?').join(',')})
         ORDER BY t.name COLLATE NOCASE`,
        ids,
    );

    for (const row of rows) {
        const key = String(row.entry_id);
        result.set(key, [...(result.get(key) ?? []), String(row.name)]);
    }
    return result;
}

function parseOptions(raw: unknown): string[] | undefined {
    if (typeof raw !== 'string' || !raw) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
        return undefined;
    }
}

export async function loadVariables(db: Database, ids: string[]): Promise<Map<string, TemplateVariable[]>> {
    const result = new Map<string, TemplateVariable[]>();
    if (ids.length === 0) {
        return result;
    }

    const rows = await all(
        db,
        `SELECT * FROM template_variables WHERE entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`,
        ids,
    );

    for (const row of rows) {
        const key = String(row.entry_id);
        const variable: TemplateVariable = {
            name: String(row.name),
            label: row.label == null ? undefined : String(row.label),
            default_value: row.default_value == null ? undefined : String(row.default_value),
            required: Boolean(row.required),
            field_type: String(row.field_type) as TemplateVariable['field_type'],
            options: parseOptions(row.options),
        };
        result.set(key, [...(result.get(key) ?? []), variable]);
    }
    return result;
}

function toEntry(row: Row, tags: string[], variables: TemplateVariable[]): LibraryEntry {
    return {
        id: String(row.id),
        title: String(row.title),
        content: String(row.content),
        fields: EntryFieldsSchema.parse(JSON.parse(String(row.fields))),
        syntax_language: String(row.syntax_language ?? 'plaintext') as LibraryEntry['syntax_language'],
        description: row.description == null ? undefined : String(row.description),
        category_id: row.category_id == null ? undefined : String(row.category_id),
        tags,
        is_favorite: Boolean(row.is_favorite),
        is_template: Boolean(row.is_template),
        is_archived: Boolean(row.is_archived),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        last_used_at: row.last_used_at == null ? undefined : String(row.last_used_at),
        use_count: Number(row.use_count ?? 0),
        variables,
    };
}

async function hydrate(db: Database, rows: Row[]): Promise<LibraryEntry[]> {
    const ids = rows.map((row) => String(row.id));
    const [tags, variables] = await Promise.all([loadTags(db, ids), loadVariables(db, ids)]);
    return rows.map((row) => toEntry(row, tags.get(String(row.id)) ?? [], variables.get(String(row.id)) ?? []));
}

async function deleteUnusedTags(db: Database, ids: string[]): Promise<void> {
    if (ids.length > 0) {
        await run(db, `DELETE FROM tags WHERE id IN (${ids.map(() => '?').join(',')})
            AND NOT EXISTS (SELECT 1 FROM entry_tags WHERE tag_id = tags.id)`, ids);
    }
}

export async function setTags(db: Database, entryId: string, tags: string[]): Promise<void> {
    const previous = await all(db, 'SELECT tag_id FROM entry_tags WHERE entry_id = ?', [entryId]);
    await run(db, 'DELETE FROM entry_tags WHERE entry_id = ?', [entryId]);

    for (const name of normalizeTags(tags)) {
        const existing = await get(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [name]);
        const tagId = existing ? String(existing.id) : randomUUID();
        if (!existing) {
            await run(db, 'INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)', [tagId, name, new Date().toISOString()]);
        }
        await run(db, 'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [entryId, tagId]);
    }
    await deleteUnusedTags(db, previous.map((row) => String(row.tag_id)));
}

// Definitions are retained only while their placeholders appear in content or fields.
export async function setVariables(db: Database, entryId: string, content: string, fields: EntryField[], variables?: TemplateVariable[]): Promise<void> {
    const present = new Set(entryVariableNames(content, fields));

    if (variables === undefined) {
        const rows = await all(db, 'SELECT name FROM template_variables WHERE entry_id = ?', [entryId]);
        for (const row of rows) {
            if (!present.has(String(row.name))) {
                await run(db, 'DELETE FROM template_variables WHERE entry_id = ? AND name = ?', [entryId, String(row.name)]);
            }
        }
        return;
    }

    await run(db, 'DELETE FROM template_variables WHERE entry_id = ?', [entryId]);
    const seen = new Set<string>();
    for (const variable of variables) {
        if (!present.has(variable.name) || seen.has(variable.name)) {
            continue;
        }
        seen.add(variable.name);
        await run(
            db,
            'INSERT INTO template_variables (id, entry_id, name, label, default_value, required, field_type, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [randomUUID(), entryId, variable.name, variable.label || null, variable.default_value ?? null, Number(variable.required), variable.field_type, variable.options ? JSON.stringify(variable.options) : null],
        );
    }
}

export async function reindex(db: Database, entryId: string): Promise<void> {
    const row = await get(db, 'SELECT rowid AS rid FROM entries WHERE id = ?', [entryId]);
    if (!row) {
        return;
    }

    await run(db, 'DELETE FROM entries_fts WHERE rowid = ?', [row.rid]);
    await run(
        db,
        `INSERT INTO entries_fts (rowid, title, content, description, category_name, tag_names)
         SELECT e.rowid, e.title, e.content || ' ' || COALESCE((SELECT group_concat(json_extract(value, '$.label') || ' ' || json_extract(value, '$.value'), ' ') FROM json_each(e.fields)), ''), COALESCE(e.description, ''),
                COALESCE((SELECT name FROM categories WHERE id = e.category_id), ''),
                COALESCE((SELECT group_concat(t.name, ' ') FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id), '')
         FROM entries e WHERE e.id = ?`,
        [entryId],
    );
}

export async function getEntryById(db: Database, id: string): Promise<LibraryEntry> {
    const row = await get(db, 'SELECT * FROM entries WHERE id = ?', [id]);
    if (!row) {
        throw new Error(`Entry not found: ${id}`);
    }
    return (await hydrate(db, [row]))[0];
}

export async function createEntry(db: Database, input: LibraryEntryDraft): Promise<LibraryEntry> {
    const draft = LibraryEntryDraftSchema.parse(input);
    const id = randomUUID();
    const now = new Date().toISOString();

    return transaction(db, async () => {
        await run(
            db,
            `INSERT INTO entries (id, title, content, fields, syntax_language, description, category_id, is_favorite, is_template, is_archived, created_at, updated_at, use_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [id, draft.title, draft.content, JSON.stringify(draft.fields ?? []), draft.syntax_language, draft.description ?? null, draft.category_id ?? null, Number(draft.is_favorite), Number(draft.is_template), Number(draft.is_archived), now, now],
        );
        await setTags(db, id, draft.tags);
        await setVariables(db, id, draft.content, draft.fields ?? [], draft.variables);
        await reindex(db, id);
        return getEntryById(db, id);
    });
}

export async function updateEntry(db: Database, input: LibraryEntryDraft & { id: string }): Promise<LibraryEntry> {
    const draft = LibraryEntryDraftSchema.parse(input);
    const id = input.id;

    return transaction(db, async () => {
        const existing = await get(db, 'SELECT fields FROM entries WHERE id = ?', [id]);
        if (!existing) {
            throw new Error(`Entry not found: ${id}`);
        }

        const fields = draft.fields ?? EntryFieldsSchema.parse(JSON.parse(String(existing.fields)));
        await run(
            db,
            `UPDATE entries SET title = ?, content = ?, fields = ?, syntax_language = ?, description = ?, category_id = ?, is_favorite = ?, is_template = ?, is_archived = ?, updated_at = ?
             WHERE id = ?`,
            [draft.title, draft.content, JSON.stringify(fields), draft.syntax_language, draft.description ?? null, draft.category_id ?? null, Number(draft.is_favorite), Number(draft.is_template), Number(draft.is_archived), new Date().toISOString(), id],
        );
        await setTags(db, id, draft.tags);
        await setVariables(db, id, draft.content, fields, draft.variables);
        await reindex(db, id);
        return getEntryById(db, id);
    });
}

export function deleteEntry(db: Database, id: string): Promise<void> {
    return deleteEntries(db, [id]);
}

export function deleteEntries(db: Database, ids: string[]): Promise<void> {
    if (ids.length === 0) {
        return Promise.resolve();
    }

    return transaction(db, async () => {
        const placeholders = ids.map(() => '?').join(', ');
        const rows = await all(db, `SELECT rowid AS rid FROM entries WHERE id IN (${placeholders})`, ids);
        if (rows.length === 0) {
            return;
        }
        await run(db, `DELETE FROM entries_fts WHERE rowid IN (${rows.map(() => '?').join(', ')})`, rows.map((row) => row.rid));
        await run(db, `DELETE FROM template_variables WHERE entry_id IN (${placeholders})`, ids);
        await run(db, `DELETE FROM entry_tags WHERE entry_id IN (${placeholders})`, ids);
        await run(db, 'DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM entry_tags WHERE tag_id = tags.id)');
        await run(db, `DELETE FROM entries WHERE id IN (${placeholders})`, ids);
    });
}

export async function duplicateEntry(db: Database, id: string): Promise<LibraryEntry> {
    const source = await getEntryById(db, id);
    return createEntry(db, {
        title: `${source.title} (copy)`.slice(0, 200),
        content: source.content,
        fields: source.fields,
        syntax_language: source.syntax_language,
        description: source.description,
        category_id: source.category_id,
        tags: source.tags,
        variables: source.variables,
        is_template: source.is_template,
        is_favorite: false,
        is_archived: false,
    });
}

export function toggleFavorite(db: Database, id: string): Promise<LibraryEntry> {
    return transaction(db, async () => {
        await run(db, 'UPDATE entries SET is_favorite = 1 - is_favorite WHERE id = ?', [id]);
        return getEntryById(db, id);
    });
}

export function setArchived(db: Database, id: string, value: boolean): Promise<LibraryEntry> {
    return transaction(db, async () => {
        await run(db, 'UPDATE entries SET is_archived = ? WHERE id = ?', [Number(value), id]);
        return getEntryById(db, id);
    });
}

export function setSyntaxLanguage(db: Database, id: string, language: SyntaxLanguage): Promise<LibraryEntry> {
    return transaction(db, async () => {
        await run(db, 'UPDATE entries SET syntax_language = ? WHERE id = ?', [language, id]);
        return getEntryById(db, id);
    });
}

export function recordUse(db: Database, id: string): Promise<void> {
    return transaction(db, () =>
        run(db, 'UPDATE entries SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', [new Date().toISOString(), id]),
    );
}

function filterEntries(filter: ListFilter): { where: string[]; params: unknown[]; order: string } {
    const where: string[] = [filter.view === 'archived' ? 'e.is_archived = 1' : 'e.is_archived = 0'];
    const params: unknown[] = [];
    let order = 'e.updated_at DESC';

    if (filter.view === 'favorites') {
        where.push('e.is_favorite = 1');
    }
    if (filter.view === 'recent') {
        where.push('e.last_used_at IS NOT NULL');
        order = 'e.last_used_at DESC';
    }
    if (filter.tag) {
        where.push('EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.name = ? COLLATE NOCASE)');
        params.push(filter.tag);
    }

    if (filter.category_id) {
        where.push('e.category_id = ?');
        params.push(filter.category_id);
    }

    return { where, params, order };
}

export async function listEntries(db: Database, filter: ListFilter = { view: 'all' }): Promise<EntryResults<LibraryEntry>> {
    const { where, params, order } = filterEntries(filter);
    const limit = 5000;
    const rows = await all(db, `SELECT e.* FROM entries e WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, [...params, limit + 1]);
    return { rows: await hydrate(db, rows.slice(0, limit)), truncated: rows.length > limit };
}

export async function listTags(db: Database): Promise<string[]> {
    const rows = await all(
        db,
        `SELECT DISTINCT t.name AS name FROM tags t
         JOIN entry_tags et ON et.tag_id = t.id
         JOIN entries e ON e.id = et.entry_id AND e.is_archived = 0
         ORDER BY t.name COLLATE NOCASE`,
    );
    return rows.map((row) => String(row.name));
}

// Turns free text into a safe FTS5 prefix query so punctuation can never cause a syntax error.
export function buildMatchQuery(text: string): string | null {
    const tokens = text.match(/[\p{L}\p{N}_]+/gu);
    if (!tokens || tokens.length === 0) {
        return null;
    }
    return tokens.map((token) => `"${token}"*`).join(' ');
}

export async function searchEntries(db: Database, text: string, filter: ListFilter = { view: 'all' }): Promise<EntryResults<SearchResult>> {
    const match = buildMatchQuery(text);
    if (!match) {
        return { rows: [], truncated: false };
    }

    const { where, params } = filterEntries(filter);
    const limit = 50;
    const rows = await all(
        db,
        `WITH hits AS (
             SELECT rowid AS rid, bm25(entries_fts, 10.0, 1.0, 2.0, 3.0, 4.0) AS rank
             FROM entries_fts WHERE entries_fts MATCH ?
         )
         SELECT e.*, hits.rank AS rank FROM hits
         JOIN entries e ON e.rowid = hits.rid
         WHERE ${where.join(' AND ')}
         ORDER BY hits.rank LIMIT ?`,
        [match, ...params, limit + 1],
    );

    const entries = await hydrate(db, rows.slice(0, limit));
    return { rows: entries.map((entry, index) => ({
        entry,
        preview: entry.content.replace(/\s+/g, ' ').slice(0, 140),
        rank: Number(rows[index].rank),
    })), truncated: rows.length > limit };
}
