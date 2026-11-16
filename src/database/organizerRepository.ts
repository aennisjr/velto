import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite3';
import type { Category, CategorySummary, TagSummary } from '../shared/types.js';
import { all, get, reindex, run, transaction } from './entryRepository.js';

function cleanName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('Name cannot be empty.');
    }
    if (trimmed.length > 50) {
        throw new Error('Name must be 50 characters or fewer.');
    }
    return trimmed;
}

async function reindexWhere(db: Database, sql: string, params: unknown[]): Promise<void> {
    const rows = await all(db, sql, params);
    for (const row of rows) {
        await reindex(db, String(row.id));
    }
}

export async function listCategories(db: Database): Promise<CategorySummary[]> {
    const rows = await all(
        db,
        `SELECT c.id, c.name, c.created_at,
                (SELECT COUNT(*) FROM entries e WHERE e.category_id = c.id AND e.is_archived = 0) AS count
         FROM categories c ORDER BY c.name COLLATE NOCASE`,
    );
    return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        created_at: String(row.created_at),
        count: Number(row.count),
    }));
}

export async function createCategory(db: Database, name: string): Promise<Category> {
    const clean = cleanName(name);
    return await transaction(db, async () => {
        if (await get(db, 'SELECT 1 AS x FROM categories WHERE name = ? COLLATE NOCASE', [clean])) {
            throw new Error(`A category named "${clean}" already exists.`);
        }
        const category = { id: randomUUID(), name: clean, created_at: new Date().toISOString() };
        await run(db, 'INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)', [category.id, category.name, category.created_at]);
        return category;
    });
}

export async function renameCategory(db: Database, id: string, name: string): Promise<void> {
    const clean = cleanName(name);
    return transaction(db, async () => {
        if (!(await get(db, 'SELECT 1 AS x FROM categories WHERE id = ?', [id]))) {
            throw new Error('Category not found.');
        }
        if (await get(db, 'SELECT 1 AS x FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?', [clean, id])) {
            throw new Error(`A category named "${clean}" already exists.`);
        }
        await run(db, 'UPDATE categories SET name = ? WHERE id = ?', [clean, id]);
        await reindexWhere(db, 'SELECT id FROM entries WHERE category_id = ?', [id]);
    });
}

export function deleteCategory(db: Database, id: string): Promise<void> {
    return transaction(db, async () => {
        const affected = await all(db, 'SELECT id FROM entries WHERE category_id = ?', [id]);
        await run(db, 'UPDATE entries SET category_id = NULL WHERE category_id = ?', [id]);
        await run(db, 'DELETE FROM categories WHERE id = ?', [id]);
        for (const row of affected) {
            await reindex(db, String(row.id));
        }
    });
}

export async function listTagUsage(db: Database): Promise<TagSummary[]> {
    const rows = await all(
        db,
        `SELECT t.name AS name, COUNT(e.id) AS count
         FROM tags t
         JOIN entry_tags et ON et.tag_id = t.id
         JOIN entries e ON e.id = et.entry_id
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    );
    return rows.map((row) => ({ name: String(row.name), count: Number(row.count) }));
}

// Renaming onto an existing tag (case-insensitive) merges the two.
export async function renameTag(db: Database, name: string, newName: string): Promise<void> {
    const clean = cleanName(newName);
    return transaction(db, async () => {
        const source = await get(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [name]);
        if (!source) {
            throw new Error('Tag not found.');
        }
        const sourceId = String(source.id);
        const affected = await all(db, 'SELECT entry_id AS id FROM entry_tags WHERE tag_id = ?', [sourceId]);
        const target = await get(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?', [clean, sourceId]);

        if (target) {
            await run(db, 'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT entry_id, ? FROM entry_tags WHERE tag_id = ?', [String(target.id), sourceId]);
            await run(db, 'DELETE FROM entry_tags WHERE tag_id = ?', [sourceId]);
            await run(db, 'DELETE FROM tags WHERE id = ?', [sourceId]);
        } else {
            await run(db, 'UPDATE tags SET name = ? WHERE id = ?', [clean, sourceId]);
        }

        for (const row of affected) {
            await reindex(db, String(row.id));
        }
    });
}

export function deleteTag(db: Database, name: string): Promise<void> {
    return transaction(db, async () => {
        const source = await get(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [name]);
        if (!source) {
            return;
        }
        const affected = await all(db, 'SELECT entry_id AS id FROM entry_tags WHERE tag_id = ?', [String(source.id)]);
        await run(db, 'DELETE FROM entry_tags WHERE tag_id = ?', [String(source.id)]);
        await run(db, 'DELETE FROM tags WHERE id = ?', [String(source.id)]);
        for (const row of affected) {
            await reindex(db, String(row.id));
        }
    });
}
