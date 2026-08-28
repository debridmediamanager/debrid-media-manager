import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [react()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: './src/test/setup.ts',
		// `.claude/worktrees/*` holds full checkouts of this same repo, one per
		// agent session. Without this, every session's test run collects every
		// other session's in-progress tests — so a commit here fails on code
		// this checkout does not contain, and the run takes four times as long.
		exclude: [...configDefaults.exclude, '**/.next/**', '**/.claude/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'json-summary'],
			reportsDirectory: './coverage',
			all: true,
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['**/*.test.*', 'src/test/**', 'src/utils/__tests__/**', '**/*.d.ts'],
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
