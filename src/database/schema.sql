CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    category_id TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_template INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag_id),
    FOREIGN KEY (entry_id) REFERENCES entries(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS template_variables (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT,
    default_value TEXT,
    required INTEGER NOT NULL DEFAULT 0,
    field_type TEXT NOT NULL DEFAULT 'text',
    FOREIGN KEY (entry_id) REFERENCES entries(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    title,
    content,
    description,
    category_name,
    tag_names,
    tokenize = 'porter unicode61'
);

DROP TRIGGER IF EXISTS entries_ai;
DROP TRIGGER IF EXISTS entries_ad;
DROP TRIGGER IF EXISTS entries_au;

CREATE INDEX IF NOT EXISTS idx_entries_category_id ON entries(category_id);
CREATE INDEX IF NOT EXISTS idx_entries_updated_at ON entries(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_id ON entry_tags(tag_id);
