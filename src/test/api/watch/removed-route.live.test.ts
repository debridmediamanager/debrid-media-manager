import { describe, expect, it } from 'vitest';

// Opt-in HTTP check against an isolated DMM instance, never production.
const baseUrl = process.env.DMM_ISOLATED_TEST_URL;

describe.skipIf(!baseUrl)('removed credential-bearing watch route', () => {
	it('does not expose the obsolete GET resolver', async () => {
		const url = new URL('/api/watch/windows/vlc', baseUrl);
		// The former route rejects TorBox locally, so this regression makes no
		// provider call even when run against the unfixed version.
		url.searchParams.set('service', 'tb');
		url.searchParams.set('token', 'synthetic-not-a-provider-key');
		url.searchParams.set('link', 'synthetic-link');
		const response = await fetch(url, { redirect: 'manual' });
		expect(response.status).toBe(404);
	}, 60_000);
});
