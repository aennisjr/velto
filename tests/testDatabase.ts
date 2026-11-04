import sqlite3 from 'sqlite3';
import { runMigrations } from '../src/database/migrations.js';
import { CONNECTION_PRAGMAS, loadMigrations } from '../src/database/schema.js';

export async function openTestDatabase(): Promise<sqlite3.Database> {
    const db = new sqlite3.Database(':memory:');
    await new Promise<void>((resolve, reject) => db.exec(CONNECTION_PRAGMAS, (error) => (error ? reject(error) : resolve())));
    await runMigrations(db, loadMigrations());
    return db;
}
