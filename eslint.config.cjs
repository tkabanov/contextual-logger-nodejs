// ESLint 9 flat config. Typed linting covers src, test and examples via the two tsconfigs.
const js = require('@eslint/js');
const prettier = require('eslint-plugin-prettier/recommended');
const importPlugin = require('eslint-plugin-import');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'examples/dist/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    settings: { 'import/resolver': { node: { extensions: ['.ts', '.js'] } } },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
      // TypeScript already validates module paths; the import plugin's resolver duplicates that work.
      'import/no-unresolved': 'off',
      'import/named': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Surfaces uses of enter()/seed(), which are scheduled for removal.
      '@typescript-eslint/no-deprecated': 'error',
    },
  },

  // Config and tooling files are plain CommonJS.
  {
    files: ['**/*.cjs', '**/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  prettier,
);
