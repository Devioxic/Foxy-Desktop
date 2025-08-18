/*
 ESLint configuration for Foxy
 - Resolves TypeScript path aliases ("@/*") via tsconfig
 - Applies recommended React and TS rules
 - Treats certain noisy rules as warnings to keep CI green while we iterate
*/
module.exports = {
    root: true,
    env: {
        browser: true,
        es2021: true,
        node: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // Avoid typed linting to support TS 5.9 without parser project errors
        tsconfigRootDir: __dirname,
    },
    settings: {
        react: { version: 'detect' },
        'import/resolver': {
            // Let eslint-plugin-import resolve TS paths from tsconfig
            typescript: {
                project: ['./tsconfig.json'],
            },
            node: {
                extensions: ['.js', '.jsx', '.ts', '.tsx'],
            },
        },
    },
    plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
    extends: [
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:import/recommended',
        'plugin:import/typescript',
    ],
    rules: {
        // Keep imports strict now that resolver is configured
        'import/no-unresolved': 'error',

        // Reduce noise while allowing incremental hardening
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-non-null-assertion': 'warn',
        '@typescript-eslint/ban-ts-comment': 'warn',
        '@typescript-eslint/no-empty-function': 'warn',
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/no-unused-vars': 'warn',
        'no-empty': ['warn', { allowEmptyCatch: true }],
        'no-useless-catch': 'warn',
        'no-useless-escape': 'warn',

        // React/JSX rules tuned for React 18 automatic runtime and TS usage
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'react/display-name': 'off',
        'react/no-unescaped-entities': 'warn',
        'react/no-unknown-property': 'off',
    },
    overrides: [
        {
            files: ['vite.*.config.ts', 'forge*.ts'],
            rules: {
                '@typescript-eslint/no-unused-vars': 'warn',
            },
        },
    ],
};
