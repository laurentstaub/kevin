/**
 * Règles de style : pas de `var`, fonctions fléchées pour les rappels, pas de
 * nom d'une lettre hors i, j, e, _, a, b.
 *
 *   npm run lint
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '_to_delete/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'e', '_', 'a', 'b'], properties: 'never' }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
];
