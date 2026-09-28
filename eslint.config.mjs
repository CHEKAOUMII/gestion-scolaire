import js from '@eslint/js';
import globals from 'globals';

export default [
    // Ignore patterns (replaces .eslintignore + ignorePatterns)
    {
        ignores: [
            'node_modules/',
            'dist/',
            'build/',
            'coverage/',
            '*.min.js',
            'logs/',
            'timetables/',
            '.tmp.driveupload/',
            '.firebase/',
            'vendor/'
        ]
    },

    // Node.js files (main process, preload, server, scripts, tests)
    {
        files: ['main.js', 'main/**/*.js', 'preload.js', 'server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.node,
                ...globals.es2021
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },

    // Browser-side JS files
    {
        files: ['js/**/*.js', 'app.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
                XLSX: 'readonly',
                Chart: 'readonly',
                BackupManager: 'readonly',
                setupSidebar: 'readonly',
                showToast: 'readonly',
                closeShortcutsModal: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-inner-declarations': 'off'
        }
    }
];
