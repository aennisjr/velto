import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
    { ignores: ['node_modules/**', 'dist/**', 'out/**', 'coverage/**', '.vite/**', '.upgrade-cache/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{js,cjs,mjs}'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['tests/e2e/**/*.mjs', 'tests/upgrade/**/*.mjs'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            ...reactHooks.configs.recommended.rules,
            '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
        },
    },
];
