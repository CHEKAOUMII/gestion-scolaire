module.exports = {
    root: true,
    ignorePatterns: [
        'node_modules/',
        'dist/',
        'logs/',
        'timetables/',
        '.tmp.driveupload/',
        '.firebase/'
    ],
    overrides: [
        {
            files: ['main/**/*.js', 'preload.js', 'tests/**/*.js'],
            env: {
                node: true,
                es2022: true
            },
            extends: ['eslint:recommended'],
            parserOptions: {
                ecmaVersion: 'latest'
            },
            rules: {
                'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
                'no-empty': ['error', { allowEmptyCatch: true }]
            }
        },
        {
            files: ['js/**/*.js'],
            env: {
                browser: true,
                node: true,
                es2022: true
            },
            extends: ['eslint:recommended'],
            parserOptions: {
                ecmaVersion: 'latest'
            },
            globals: {
                XLSX: 'readonly',
                Chart: 'readonly',
                BackupManager: 'readonly',
                setupSidebar: 'readonly',
                showToast: 'readonly',
                closeShortcutsModal: 'readonly'
            },
            rules: {
                'no-unused-vars': 'off',
                'no-undef': 'off',
                'no-inner-declarations': 'off'
            }
        }
    ]
};
