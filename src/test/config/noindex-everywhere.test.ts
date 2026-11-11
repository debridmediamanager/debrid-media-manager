import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: Next ships its path-to-regexp build without types
import { pathToRegexp } from 'next/dist/compiled/path-to-regexp';
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
	it('sends X-Robots-Tag noindex on every path except / and images or icons', async () => {
		const config = await loadConfig();
		const headers = (await config.headers?.()) ?? [];
		const rule = headers.find((h: { headers: { key: string }[] }) =>
			h.headers.some((x) => x.key === 'X-Robots-Tag')
		)!;
		expect(rule.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]);
		// Next matches header sources with this path-to-regexp build and these options.
		const re = pathToRegexp(rule.source, [], {
			delimiter: '/',
			sensitive: false,
			strict: true,
		});
		for (const p of ['/start', '/search', '/movie/tt0111161', '/api/torznab', '/robots.txt'])
			expect(re.test(p), p).toBe(true);
		// Google will not use a noindexed favicon or preview image (2026-11-11: search showed a globe).
		for (const p of [
			'/',
			'/social-card.png',
			'/favicon.ico',
			'/android-chrome-192x192.png',
			'/site.webmanifest',
		])
			expect(re.test(p), p).toBe(false);
	});

	it('shares a 1200x630 card and names the site for link previews', () => {
		const doc = readFileSync(join(pagesDir, '_document.tsx'), 'utf8');
		for (const tag of ['og:image', 'og:site_name', 'twitter:card', 'twitter:image'])
			expect(doc).toContain(`"${tag}"`);
		expect(doc).toContain('sizes="192x192"');
		const png = readFileSync(join(publicDir, 'social-card.png'));
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
	});

	it('has no site-wide robots meta that would also cover /', () => {
		expect(readFileSync(join(pagesDir, '_document.tsx'), 'utf8')).not.toMatch(/name="robots"/);
	});

	it('gives / its title and canonical outside withAuth, so they are in the server HTML', () => {
		const index = readFileSync(join(pagesDir, 'index.tsx'), 'utf8');
		expect(index).toMatch(/loggedOutView: StartPage/);
		const home = index.slice(index.indexOf('function Home('));
		expect(home).toContain('<title>{HOME_TITLE}</title>');
		expect(home).toContain('<link key="canonical" rel="canonical" href={SITE_URL} />');
		expect(home).toContain('application/ld+json');
		expect(home.indexOf('<Head>')).toBeLessThan(home.indexOf('<AuthedHome'));
	});

	it('keeps /start itself noindex but not the same page shown at /', () => {
		const start = readFileSync(join(pagesDir, 'start.tsx'), 'utf8');
		expect(start).toContain(
			`{router.pathname !== '/' && <meta name="robots" content="noindex, nofollow" />}`
		);
		expect(start).not.toMatch(/rel="canonical"/);
	});

	it.each(
		pageFiles(pagesDir)
			.map((p) => [p.slice(pagesDir.length)])
			.filter(([p]) => p !== '/index.tsx')
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
