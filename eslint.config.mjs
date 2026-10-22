import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import noDeprecated from './eslint-rules/no-deprecated.mjs';

const require = createRequire(import.meta.url);

// Next's former recommended React/a11y/import rules and core-web-vitals
// run in Oxlint; only hooks, the missing deprecated-API rule, and typed
// promise checking need ESLint. Do not enable unrelated recommended sets.
export default [
	{
		ignores: [
			'.next/**',
			'out/**',
			'build/**',
			'next-env.d.ts',
			'prod_node_modules/**',
			'.claude/**',
		],
	},
	{
		files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: { ecmaFeatures: { jsx: true } },
		},
		linterOptions: { reportUnusedDisableDirectives: 'off' },
		plugins: {
			'react-hooks': reactHooks,
			react: { rules: { 'no-deprecated': noDeprecated } },
		},
		settings: { react: { version: require('react/package.json').version } },
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn',
			'react/no-deprecated': 'error',
		},
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				project: './tsconfig.eslint.json',
				tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
			},
		},
		plugins: { '@typescript-eslint': tsPlugin },
		rules: {
			'@typescript-eslint/no-misused-promises': [
				'error',
				{ checksConditionals: true, checksVoidReturn: false, checksSpreads: false },
			],
		},
	},
];
