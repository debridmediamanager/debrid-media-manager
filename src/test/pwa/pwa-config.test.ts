import { describe, expect, it } from 'vitest';

const config = require('../../../pwa.config.js');
const excluded = (path: string) => config.exclude.some((re: RegExp) => re.test(path));

describe('pwa.config', () => {
	it('precaches neither source maps, manifests nor the dynamic css manifest', () => {
		expect(excluded('static/chunks/main.js.map')).toBe(true);
		expect(excluded('manifest.abc.js')).toBe(true);
		expect(excluded('_next/dynamic-css-manifest.json')).toBe(true);
		expect(excluded('static/chunks/main.js')).toBe(false);
	});

	// Cast notice MP4s are downloaded only when a cast needs one.
	it('leaves noprecache out of the public precache', () => {
		expect(config.globPublicPatterns).toEqual(['!(noprecache){,/**}']);
	});

	it('adds the offline page to the precache', async () => {
		const [transform] = config.manifestTransforms;
		const { manifest } = await transform([{ url: '/a', revision: '1', size: 1 }]);
		expect(manifest.map((e: { url: string }) => e.url)).toContain('/_offline');
	});

	it('serves the worker from the URL existing installs update from', () => {
		expect(config.swUrl).toBe('/service-worker.js');
		expect(config.scope).toBe('/');
	});
});
