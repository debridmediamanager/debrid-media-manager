import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import loadConfig from '../../../next.config.js';

/**
 * DMM stays out of search engines. Google reported "chose different canonical than user"
 * on 2026-10-26 because the status pages declared canonicals, / and /start asked for
 * `index`, and every page's og:url pointed at the homepage.
 */
const pagesDir = join(__dirname, '../../pages');
const pageFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'api' ? [] : pageFiles(path);
		return path.endsWith('.tsx') ? [path] : [];
	});

describe('noindex everywhere', () => {
	it('sends X-Robots-Tag noindex on every path', async () => {
		const config = await loadConfig();
		const headers = (await config.headers?.()) ?? [];
		expect(headers).toContainEqual({
			source: '/:path*',
			headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
		});
	});

	it.each(pageFiles(pagesDir).map((p) => [p.slice(pagesDir.length)]))(
		'%s declares no index, canonical or og:url',
		(page) => {
			const source = readFileSync(join(pagesDir, page), 'utf8');
			expect(source).not.toMatch(/name="robots" content="index/);
			expect(source).not.toMatch(/rel="canonical"/);
			expect(source).not.toMatch(/og:url/);
		}
	);
});
