import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// The pure core (/sim, /time, /content, /rng) may never reach the DOM, the
// renderer, or Three.js. This rule is what keeps replays and tests honest.
const impureImports = {
  patterns: [
    { group: ['**/render', '**/render/**'], message: 'Pure core may not import the renderer.' },
    { group: ['**/platform', '**/platform/**'], message: 'Pure core may not import platform code.' },
    { group: ['**/ui', '**/ui/**'], message: 'Pure core may not import UI code.' },
    { group: ['**/debug', '**/debug/**', '**/editor', '**/editor/**'], message: 'Pure core may not import dev tools.' },
    { group: ['**/replay', '**/replay/**'], message: 'Pure core may not import the replay layer.' },
    { group: ['three', 'three/**'], message: 'Pure core may not import Three.js.' },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/sim/**', 'src/time/**', 'src/content/**', 'src/rng/**'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', impureImports],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'localStorage', 'requestAnimationFrame'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use a seeded stream from /rng.' },
        { object: 'Date', property: 'now', message: 'No wall-clock reads inside the sim.' },
      ],
    },
  },
);
