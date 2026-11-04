export const SYNTAX_LANGUAGE_VALUES = [
    'plaintext',
    'javascript',
    'typescript',
    'json',
    'python',
    'bash',
    'sql',
    'html',
    'css',
    'yaml',
    'markdown',
] as const;

export const SYNTAX_LANGUAGES = [
    { value: 'plaintext', label: 'Plain text' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'json', label: 'JSON' },
    { value: 'python', label: 'Python' },
    { value: 'bash', label: 'Bash' },
    { value: 'sql', label: 'SQL' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
    { value: 'yaml', label: 'YAML' },
    { value: 'markdown', label: 'Markdown' },
] as const;

export type SyntaxLanguage = (typeof SYNTAX_LANGUAGE_VALUES)[number];
