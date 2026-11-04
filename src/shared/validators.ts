import { z } from 'zod';
import { SYNTAX_LANGUAGE_VALUES } from './syntaxLanguages.js';

export const TemplateVariableNameSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, 'Names may contain letters, numbers, and underscores, and must not start with a number.');

export const TemplateVariableSchema = z
    .object({
        name: TemplateVariableNameSchema,
        label: z.string().trim().max(120).optional(),
        default_value: z.string().max(2000).optional(),
        required: z.boolean().default(true),
        field_type: z.enum(['text', 'multiline', 'date', 'number', 'dropdown']).default('text'),
        options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    })
    .refine((value) => value.field_type !== 'dropdown' || (value.options?.length ?? 0) > 0, {
        message: 'A dropdown needs at least one option.',
        path: ['options'],
    });
export const LibraryEntryDraftSchema = z.object({
    id: z.string().min(1).max(128).optional(),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(500000).default(''),
    syntax_language: z.enum(SYNTAX_LANGUAGE_VALUES).default('plaintext'),
    description: z.string().max(2000).optional(),
    category_id: z.string().max(128).optional(),
    is_favorite: z.boolean().default(false),
    is_template: z.boolean().default(false),
    is_archived: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
    variables: z.array(TemplateVariableSchema).max(100).optional(),
});

export const EntryIdSchema = z.string().min(1).max(128);
export const EntryIdsSchema = z.array(EntryIdSchema).min(1).max(5000).refine((ids) => new Set(ids).size === ids.length, {
    message: 'Entry IDs must be unique.',
});

export const SearchQuerySchema = z.string().max(500);

export const ListFilterSchema = z.object({
    view: z.enum(['all', 'favorites', 'recent', 'archived']),
    tag: z.string().min(1).max(50).optional(),
    category_id: z.string().min(1).max(100).optional(),
});

export const NameSchema = z.string().min(1).max(50);
export const RenameTagSchema = z.object({ name: NameSchema, newName: NameSchema });
export const RenameCategorySchema = z.object({ id: z.string().min(1).max(100), name: NameSchema });

export const CopyPayloadSchema = z.object({
    text: z.string().max(1000000),
    entryId: EntryIdSchema.optional(),
});

export type LibraryEntryDraft = z.input<typeof LibraryEntryDraftSchema>;
export type ParsedEntryDraft = z.output<typeof LibraryEntryDraftSchema>;
export type TemplateVariableInput = z.input<typeof TemplateVariableSchema>;
