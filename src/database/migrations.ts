import type { Database } from 'sqlite3';

export interface Migration {
    version: number;
    sql: string;
}

function exec(db: Database, sql: string): Promise<void> {
    return new Promise((resolve, reject) => db.exec(sql, (error) => (error ? reject(error) : resolve())));
}

function userVersion(db: Database): Promise<number> {
    return new Promise((resolve, reject) => {
        db.get('PRAGMA user_version', (error, row: { user_version: number } | undefined) =>
            error ? reject(error) : resolve(row?.user_version ?? 0),
        );
    });
}

export function latestVersion(migrations: Migration[]): number {
    return migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
}

// Each migration runs in its own transaction and bumps user_version with it, so a failure leaves the previous version intact.
export async function runMigrations(db: Database, migrations: Migration[]): Promise<number> {
    const ordered = [...migrations].sort((a, b) => a.version - b.version);
    ordered.forEach((migration, index) => {
        if (migration.version !== index + 1) {
            throw new Error(`Migrations must be numbered 1..n without gaps (found ${migration.version} at position ${index + 1}).`);
        }
    });

    const current = await userVersion(db);
    const latest = latestVersion(ordered);
    if (current > latest) {
        throw new Error(`This library was created by a newer version of Velto (schema ${current}, this app supports ${latest}).`);
    }

    for (const migration of ordered.filter((item) => item.version > current)) {
        await exec(db, 'BEGIN');
        try {
            await exec(db, migration.sql);
            await exec(db, `PRAGMA user_version = ${migration.version}`);
            await exec(db, 'COMMIT');
        } catch (error) {
            await exec(db, 'ROLLBACK').catch(() => undefined);
            throw new Error(`Migration ${migration.version} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return userVersion(db);
}
