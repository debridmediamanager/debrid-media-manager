import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SW_PATH = path.join(process.cwd(), 'public', 'service-worker.js');

const extractPrecacheUrls = (swContent: string): string[] => {
	const match = swContent.match(/precacheAndRoute\(\[(.+?)\],/s);
	if (!match) return [];
	const urlMatches = match[1].matchAll(/url:"([^"]+)"/g);
	return Array.from(urlMatches, (m) => m[1]);
};

describe('service worker build output', () => {
	const swContent = readFileSync(SW_PATH, 'utf-8');
	const precacheUrls = extractPrecacheUrls(swContent);

	it('has precache entries', () => {
		expect(precacheUrls.length).toBeGreaterThan(0);
	});

	it('does not precache dynamic-css-manifest.json', () => {
		const offending = precacheUrls.filter((url) => url.includes('dynamic-css-manifest'));
		expect(offending).toEqual([]);
	});

	it('does not precache server-only manifests', () => {
		const serverManifests = precacheUrls.filter(
			(url) =>
				url.includes('react-loadable-manifest') ||
				url.includes('build-manifest.json') ||
				url.startsWith('/_next/server/')
		);
		expect(serverManifests).toEqual([]);
	});

	it('all precache entries have valid url format', () => {
		for (const url of precacheUrls) {
			expect(url).toMatch(/^[\/_]/);
		}
	});

	it('precache entries only reference static assets, not API routes', () => {
		const apiRoutes = precacheUrls.filter((url) => url.includes('/api/'));
		expect(apiRoutes).toEqual([]);
	});
});
