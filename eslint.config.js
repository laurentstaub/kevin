/**
 * Règles de style, peu nombreuses et vérifiables.
 *
 * - pas de `var` : `const` par défaut, `let` quand la valeur change ;
 * - des fonctions fléchées pour les rappels (`.map((ligne) => …)`) ;
 * - pas de nom d'une lettre, sauf les indices (i, j), l'événement (e), le
 *   paramètre ignoré (_) et le couple d'un comparateur de tri (a, b) :
 *   `f.noms`, `n.dosages` se lisaient bien en écrivant la ligne, mal en la
 *   relisant un mois plus tard.
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
