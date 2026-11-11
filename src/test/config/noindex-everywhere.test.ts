import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import loadConfig from '../../../next.config.js';

/**
 * Only the home page goes into search engines (Ben, 2026-11-11). Every other path sends
 * X-Robots-Tag noindex. Google reported "chose different canonical than user" on 2026-10-26
 * because the status pages declared canonicals, / and /start asked for `index`, and every
 * page's og:url pointed at the homepage: so one canonical, on the page shown at /, and no
 * index hints anywhere else.
 */
const pagesDir = join(__dirname, '../../pages');
const publicDir = join(__dirname, '../../../public');
const pageFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'api' ? [] : pageFiles(path);
		return path.endsWith('.tsx') ? [path] : [];
	});

describe('only the home page is indexed', () => {
	it('sends X-Robots-Tag noindex on every path except /', async () => {
		const config = await loadConfig();
		const headers = (await config.headers?.()) ?? [];
		expect(headers).toContainEqual({
			source: '/:path+',
			headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
		});
		// `/:path*` would also match / itself
		expect(headers.some((h: { source: string }) => h.source === '/:path*')).toBe(false);
	});

	it('has no site-wide robots meta that would also cover /', () => {
		expect(readFileSync(join(pagesDir, '_document.tsx'), 'utf8')).not.toMatch(/name="robots"/);
	});

	it('gives the page shown at / its canonical and keeps /start itself noindex', () => {
		const start = readFileSync(join(pagesDir, 'start.tsx'), 'utf8');
		expect(start).toMatch(/router\.pathname === '\/' \?/);
		expect(start).toContain('<link rel="canonical" href="https://debridmediamanager.com/" />');
		expect(start).toContain('<meta name="robots" content="noindex, nofollow" />');
		expect(readFileSync(join(pagesDir, 'index.tsx'), 'utf8')).toMatch(
			/loggedOutView: StartPage/
		);
	});

	it.each(
		pageFiles(pagesDir)
			.map((p) => [p.slice(pagesDir.length)])
			.filter(([p]) => p !== '/start.tsx')
	)('%s declares no index, canonical or og:url', (page) => {
		const source = readFileSync(join(pagesDir, page), 'utf8');
		expect(source).not.toMatch(/name="robots" content="index/);
		expect(source).not.toMatch(/rel="canonical"/);
		expect(source).not.toMatch(/og:url/);
	});

	it('lets crawlers in and lists only the home page in the sitemap', () => {
		const robots = readFileSync(join(publicDir, 'robots.txt'), 'utf8');
		expect(robots).toMatch(/^Allow: \/$/m);
		expect(robots).toContain('Sitemap: https://debridmediamanager.com/sitemap.xml');
		const locs = readFileSync(join(publicDir, 'sitemap.xml'), 'utf8').match(
			/<loc>[^<]*<\/loc>/g
		);
		expect(locs).toEqual(['<loc>https://debridmediamanager.com/</loc>']);
	});
});
