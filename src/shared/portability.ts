import { z } from 'zod';
import { EntryFieldsSchema, TemplateVariableSchema } from './validators.js';
import { SYNTAX_LANGUAGE_VALUES } from './syntaxLanguages.js';

export const LIBRARY_FORMAT = 'velto-library';
export const LIBRARY_FORMAT_VERSION = 5;
export const MAX_IMPORT_ENTRIES = 50000;
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const Timestamp = z
    .string()
    .max(40)
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp');

export const ExportedEntrySchema = z.object({
    id: z.string().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(500000),
    fields: EntryFieldsSchema.default([]),
    syntax_language: z.enum(SYNTAX_LANGUAGE_VALUES).default('plaintext'),
    description: z.string().max(2000).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
    variables: z.array(TemplateVariableSchema).max(100).default([]),
    is_favorite: z.boolean().default(false),
    is_template: z.boolean().default(false),
    is_archived: z.boolean().default(false),
    created_at: Timestamp,
    updated_at: Timestamp,
    last_used_at: Timestamp.optional(),
    use_count: z.number().int().min(0).max(1e9).default(0),
});

export const LibraryFileSchema = z.object({
    format: z.literal(LIBRARY_FORMAT),
    version: z.number().int().min(1).max(LIBRARY_FORMAT_VERSION),
    exported_at: Timestamp,
    app_version: z.string().max(32).optional(),
    categories: z.array(z.string().trim().min(1).max(50)).max(1000).default([]),
    entries: z.array(ExportedEntrySchema).max(MAX_IMPORT_ENTRIES),
});

export const ImportModeSchema = z.enum(['merge', 'duplicate', 'replace']);

export type ExportedEntry = z.output<typeof ExportedEntrySchema>;
export type LibraryFile = z.output<typeof LibraryFileSchema>;
export type ImportMode = z.infer<typeof ImportModeSchema>;

export interface ExportResult {
    path: string;
    count: number;
}

export interface ImportPreview {
    fileName: string;
    exportedAt: string;
    total: number;
    added: number;
    changed: number;
    identical: number;
    newerLocally: number;
}

export interface ImportResult {
    added: number;
    updated: number;
    skipped: number;
    backupPath?: string;
}
