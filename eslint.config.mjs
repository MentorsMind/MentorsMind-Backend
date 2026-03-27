import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      '@typescript-eslint/ban-ts-comment': 'off',
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'jest.config.js',
      'jest.config.ts',
      'jest.ws.config.ts',
      'jest.unit.config.ts',
      '**/*.test.ts',
      'src/**/__tests__/**',
      'eslint.config.mjs',
      'database/**',
      'load-tests/**',
    ],
  }
);