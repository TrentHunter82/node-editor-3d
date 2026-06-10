import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importPlugin from 'eslint-plugin-import'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Honor the `_` prefix for intentionally-unused vars/args/catch bindings,
      // matching TypeScript's noUnusedLocals/noUnusedParameters behavior.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Test files use `any` freely for mocks/fixtures — don't treat that as an error.
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Circular-import detection for app code (tests excluded for lint speed).
    // The codebase already needed a manual cycle break once (nodeDepth.ts was
    // split out of NodeScreen ↔ nodeSlice) — this catches regressions.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'src/test/**'],
    plugins: { import: importPlugin },
    settings: {
      'import/extensions': ['.ts', '.tsx'],
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] } },
    },
    rules: {
      'import/no-cycle': ['error', { maxDepth: 6, ignoreExternal: true }],
    },
  },
])
