import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Migration } from './migrations.js';

export const CONNECTION_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;';

function getSchemaPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(currentDir, 'schema.sql'),
        path.resolve(currentDir, '../../../src/database/schema.sql'),
        path.resolve(currentDir, '../../src/database/schema.sql'),
    ];

    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    if (!existing) {
        throw new Error(`Could not find schema.sql in any expected location. Checked: ${candidates.join(', ')}`);
    }
    return existing;
}

const VERSION_2_SQL = `
ALTER TABLE template_variables ADD COLUMN options TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_variables_entry_name ON template_variables(entry_id, name);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

const VERSION_3_SQL = `
ALTER TABLE entries ADD COLUMN syntax_language TEXT NOT NULL DEFAULT 'plaintext';
`;

const VERSION_4_SQL = `
DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM entry_tags WHERE tag_id = tags.id);
`;

const VERSION_5_SQL = `
ALTER TABLE entries ADD COLUMN fields TEXT NOT NULL DEFAULT '[]';
`;

// Version 1 is the original schema. It is idempotent, so libraries created before versioning upgrade cleanly.
// Later schema changes are added here as new numbered migrations.
export function loadMigrations(): Migration[] {
    return [
        { version: 1, sql: fs.readFileSync(getSchemaPath(), 'utf8') },
        { version: 2, sql: VERSION_2_SQL },
        { version: 3, sql: VERSION_3_SQL },
        { version: 4, sql: VERSION_4_SQL },
        { version: 5, sql: VERSION_5_SQL },
    ];
}
