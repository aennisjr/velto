import path from 'node:path';
import { app } from 'electron';
import sqlite3 from 'sqlite3';
import { runMigrations } from './migrations.js';
import { CONNECTION_PRAGMAS, loadMigrations } from './schema.js';

export type VeltoDatabase = sqlite3.Database;

export async function initializeDatabase(): Promise<VeltoDatabase> {
    const dbPath = path.join(app.getPath('userData'), 'velto.db');
    const migrations = loadMigrations();

    const db = await new Promise<VeltoDatabase>((resolve, reject) => {
        const opened = new sqlite3.Database(dbPath, (openError) => (openError ? reject(openError) : resolve(opened)));
    });

    try {
        await new Promise<void>((resolve, reject) => db.exec(CONNECTION_PRAGMAS, (error) => (error ? reject(error) : resolve())));
        await runMigrations(db, migrations);
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
}

export async function closeDatabase(db: VeltoDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
        db.close((closeError) => {
            if (closeError) {
                reject(closeError);
                return;
            }

            resolve();
        });
    });
}

export async function query<T = Record<string, unknown>>(
    db: VeltoDatabase,
    sql: string,
    params: unknown[] = [],
): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows as T[]);
        });
    });
}

export async function run(
    db: VeltoDatabase,
    sql: string,
    params: unknown[] = [],
): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}
