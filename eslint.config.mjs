import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'logs/**', 'tools/**', 'coverage/**'] },

  // Frontend (src/) — browser globals, React rules
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // Vite's JSX runtime handles this
      'react/prop-types': 'off', // no PropTypes convention in this codebase
      'react-refresh/only-export-components': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty `catch (e) {}` is a deliberate, pervasive pattern in this
      // codebase for best-effort/fire-and-forget calls (background
      // fetches, optional cleanup) — not a mistake to flag.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // eslint-plugin-react-hooks v7 ships the newer, stricter "Rules of
      // React" checks (refs-during-render, set-state-in-effect,
      // immutability) alongside the classic hooks rules. Several existing
      // files predate these checks and would need real behavioral changes,
      // not just lint fixes, to satisfy them — downgraded to warnings so
      // lint stays actionable without blocking on unrelated pre-existing
      // code. Revisit case-by-case rather than fixing in bulk.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },

  // Vite config is always loaded as an ES module by Vite itself, regardless
  // of the project's own "type" field.
  {
    files: ['vite.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },

  // Backend (server/, root config/scripts) — Node/CommonJS globals
  {
    files: ['server/**/*.js', '*.js', 'test/**/*.js'],
    ignores: ['src/**', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty `catch (e) {}` is a deliberate, pervasive pattern in this
      // codebase for best-effort/fire-and-forget calls (background
      // fetches, optional cleanup) — not a mistake to flag.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  prettierConfig, // must stay last — disables formatting rules that would fight Prettier
];
