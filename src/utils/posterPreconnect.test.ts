import { afterEach, describe, expect, it } from 'vitest';
import { POSTER_PRECONNECT_SCRIPT } from './posterPreconnect';

const run = (hostname: string) => new Function('location', POSTER_PRECONNECT_SCRIPT)({ hostname });
const links = (rel: string) =>
	[...document.head.querySelectorAll(`link[rel="${rel}"]`)].map((l) => l.getAttribute('href'));

afterEach(() => {
	document.head.innerHTML = '';
});

describe('poster preconnect script', () => {
	it('warms posters0-9 on debridmediamanager.com, as the fixed tags did', () => {
		run('debridmediamanager.com');
		const hosts = Array.from(
			{ length: 10 },
			(_, i) => `https://posters${i}.debridmediamanager.com`
		);
		expect(links('preconnect')).toEqual(hosts);
		expect(links('dns-prefetch')).toEqual(hosts);
		expect(
			[...document.head.querySelectorAll('link[rel="preconnect"]')].every(
				(l) => (l as HTMLLinkElement).crossOrigin === 'anonymous'
			)
		).toBe(true);
	});

	it('adds nothing on a self-hosted copy', () => {
		for (const host of [
			'localhost',
			'192.168.1.20',
			'dmm.example.org',
			'debridmediamanager.com.evil.example',
		])
			run(host);
		expect(document.head.querySelectorAll('link')).toHaveLength(0);
	});
});
