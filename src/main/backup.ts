import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from 'sqlite3';
import { buildLibraryFile } from '../database/portability.js';
import type { BackupInfo } from '../shared/settings.js';

export const AUTO_BACKUP_PREFIX = 'velto-auto-';
export const MANUAL_BACKUP_PREFIX = 'velto-backup-';
export const KEEP_AUTO_BACKUPS = 7;
export const AUTO_BACKUP_INTERVAL_MS = 20 * 60 * 60 * 1000;

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function backupFiles(directory: string): Promise<{ name: string; modified: number }[]> {
    let names: string[];
    try {
        names = await readdir(directory);
    } catch {
        return [];
    }

    const files: { name: string; modified: number }[] = [];
    for (const name of names) {
        if (name.endsWith('.velto') && (name.startsWith(AUTO_BACKUP_PREFIX) || name.startsWith(MANUAL_BACKUP_PREFIX))) {
            files.push({ name, modified: (await stat(path.join(directory, name))).mtimeMs });
        }
    }
    return files.sort((a, b) => b.modified - a.modified);
}

export async function createBackup(
    db: Database,
    directory: string,
    appVersion: string,
    kind: 'auto' | 'manual',
    now = new Date(),
): Promise<{ path: string; count: number }> {
    const file = await buildLibraryFile(db, appVersion);
    await mkdir(directory, { recursive: true });
    const prefix = kind === 'auto' ? AUTO_BACKUP_PREFIX : MANUAL_BACKUP_PREFIX;
    const target = path.join(directory, `${prefix}${stamp(now)}.velto`);
    // Written under a temporary name first so an interrupted write never leaves a truncated backup.
    await writeFile(`${target}.tmp`, JSON.stringify(file), 'utf8');
    await rename(`${target}.tmp`, target);
    return { path: target, count: file.entries.length };
}

export async function rotateAutoBackups(directory: string, keep = KEEP_AUTO_BACKUPS): Promise<number> {
    const autos = (await backupFiles(directory)).filter((file) => file.name.startsWith(AUTO_BACKUP_PREFIX));
    const stale = autos.slice(keep);
    for (const file of stale) {
        await unlink(path.join(directory, file.name));
    }
    return stale.length;
}

// Skips empty libraries and anything backed up recently, so frequent restarts do not churn files.
export async function runAutoBackup(
    db: Database,
    directory: string,
    appVersion: string,
    now = new Date(),
): Promise<{ path: string; count: number } | null> {
    const latestAuto = (await backupFiles(directory)).find((file) => file.name.startsWith(AUTO_BACKUP_PREFIX));
    if (latestAuto && now.getTime() - latestAuto.modified < AUTO_BACKUP_INTERVAL_MS) {
        return null;
    }

    const library = await buildLibraryFile(db, appVersion);
    if (library.entries.length === 0) {
        return null;
    }

    const result = await createBackup(db, directory, appVersion, 'auto', now);
    await rotateAutoBackups(directory);
    return result;
}

export async function describeBackups(directory: string): Promise<BackupInfo> {
    const files = await backupFiles(directory);
    return {
        directory,
        latest: files[0] ? { name: files[0].name, modifiedAt: new Date(files[0].modified).toISOString() } : null,
        count: files.length,
    };
}
