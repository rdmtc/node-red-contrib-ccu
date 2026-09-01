const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const globals = require('globals');
const html = require('eslint-plugin-html');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            // excluded from linting since the xo days — burn down later
            'nodes/ccu-switch.js',
            'nodes/ccu-switch.html',
            'tools/paramsets-join.js',
        ],
    },
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
            'no-empty': ['error', {allowEmptyCatch: true}],
        },
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            globals: {...globals.node, ...globals.mocha},
        },
    },
    {
        // editor-side scripts embedded in the node .html files
        files: ['nodes/**/*.html'],
        plugins: {html},
        languageOptions: {
            sourceType: 'script',
            globals: {...globals.browser, ...globals.jquery, RED: 'readonly'},
        },
    },
];
