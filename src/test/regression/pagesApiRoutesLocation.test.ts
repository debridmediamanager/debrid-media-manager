import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const apiDir = path.join(process.cwd(), 'src/pages/api');
const pagesDir = path.join(process.cwd(), 'src/pages');

const findTestFiles = (dir: string, base = dir) => {
	const entries = readdirSync(dir, { withFileTypes: true });
	const matches: string[] = [];
	for (const entry of entries) {
		const resolved = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			matches.push(...findTestFiles(resolved, base));
			continue;
		}
		if (/\.test\.(t|j)sx?$/.test(entry.name)) {
			matches.push(path.relative(base, resolved));
		}
	}
	return matches;
};

describe('pages/api folder hygiene', () => {
	it('does not contain *.test.* files that break Next.js dev server', () => {
		const badFiles = findTestFiles(apiDir);
		expect(badFiles).toEqual([]);
	});
});

describe('pages folder hygiene', () => {
	// There is no `pageExtensions` override, so *every* file under src/pages is a
	// route: a colocated test would publish itself at e.g. /transfers.test.
	it('does not contain *.test.* files anywhere, since each would become a route', () => {
		expect(findTestFiles(pagesDir)).toEqual([]);
	});
});
