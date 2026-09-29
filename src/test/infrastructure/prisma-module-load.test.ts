/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';

/**
 * Prisma ships in the browser bundle, as a stub whose query helpers throw
 * ("raw is unable to run in this browser environment"). A helper called at
 * module load therefore runs in every browser that loads a page importing the
 * module, however indirectly, and took the whole site down on 2026-09-29: a
 * top-level `Prisma.raw` in `imdbSearch.ts` left every page on its loading
 * screen. Unit tests and the build both passed, because Node has the real
 * helpers. This stands the browser stub in and loads every database module.
 */
vi.mock('@prisma/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@prisma/client')>();
	const refuse = (name: string) => () => {
		throw new Error(`${name} is unable to run in this browser environment`);
	};
	return {
		...actual,
		Prisma: {
			...actual.Prisma,
			raw: refuse('raw'),
			sql: refuse('sql'),
			join: refuse('join'),
		},
	};
});

const modules = import.meta.glob(['../../services/database/*.ts', '!**/*.test.ts']);

describe('database modules at load time', () => {
	it('finds the modules it is meant to guard', () => {
		expect(Object.keys(modules).length).toBeGreaterThan(10);
		expect(Object.keys(modules)).toContain('../../services/database/imdbSearch.ts');
	});

	it.each(Object.keys(modules))('%s builds no SQL until a query runs', async (path) => {
		await expect(modules[path]()).resolves.toBeDefined();
	});
});
