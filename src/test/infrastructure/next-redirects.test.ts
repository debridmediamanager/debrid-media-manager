import { describe, expect, it } from 'vitest';
import loadConfig from '../../../next.config.js';

// The RD filename filter page was removed on 2026-10-03; the Patreon post is the
// one complete copy now, and links to the old page (Discord, Reddit, old
// Settings builds) must land there rather than on a 404.
describe('next.config redirects', () => {
	it('sends the removed RD filename filter page to the Patreon post', async () => {
		const nextConfig = await loadConfig();
		if (!nextConfig.redirects) throw new Error('Expected Next redirect configuration');
		const redirects = await nextConfig.redirects();
		expect(redirects).toContainEqual({
			source: '/rd-filename-filters.html',
			destination:
				'https://www.patreon.com/debridmediamanager/posts/complete-list-of-158388927',
			permanent: true,
		});
	});
});
