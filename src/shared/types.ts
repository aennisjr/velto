import type { SyntaxLanguage } from './syntaxLanguages.js';

export interface Category {
    id: string;
    name: string;
    created_at: string;
}

export interface Tag {
    id: string;
    name: string;
    created_at: string;
}

export interface EntryField {
    label: string;
    value: string;
}

export interface LibraryEntry {
    id: string;
    title: string;
    content: string;
    fields: EntryField[];
    syntax_language: SyntaxLanguage;
    description?: string;
    category_id?: string;
    tags: string[];
    is_favorite: boolean;
    is_template: boolean;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
    last_used_at?: string;
    use_count: number;
    variables: TemplateVariable[];
}

export type VariableFieldType = 'text' | 'multiline' | 'date' | 'number' | 'dropdown';

export interface TemplateVariable {
    name: string;
    label?: string;
    default_value?: string;
    required: boolean;
    field_type: VariableFieldType;
    options?: string[];
}

export interface SearchResult {
    entry: LibraryEntry;
    preview: string;
    rank: number;
}

export interface EntryResults<T> {
    rows: T[];
    truncated: boolean;
}

export type LibraryView = 'all' | 'favorites' | 'recent' | 'archived';

export interface ListFilter {
    view: LibraryView;
    tag?: string;
    category_id?: string;
}

export interface CategorySummary extends Category {
    count: number;
}

export interface TagSummary {
    name: string;
    count: number;
}
