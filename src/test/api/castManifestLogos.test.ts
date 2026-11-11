import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import ad from '@/pages/api/stremio-ad/[userid]/manifest.json';
import adBare from '@/pages/api/stremio-ad/[userid]/no-catalog/manifest.json';
import dl from '@/pages/api/stremio-dl/[userid]/manifest.json';
import dlBare from '@/pages/api/stremio-dl/[userid]/no-catalog/manifest.json';
import en from '@/pages/api/stremio-en/[userid]/manifest.json';
import enBare from '@/pages/api/stremio-en/[userid]/no-catalog/manifest.json';
import oc from '@/pages/api/stremio-oc/[userid]/manifest.json';
import ocBare from '@/pages/api/stremio-oc/[userid]/no-catalog/manifest.json';
import pm from '@/pages/api/stremio-pm/[userid]/manifest.json';
import pmBare from '@/pages/api/stremio-pm/[userid]/no-catalog/manifest.json';
import tb from '@/pages/api/stremio-tb/[userid]/manifest.json';
import tbBare from '@/pages/api/stremio-tb/[userid]/no-catalog/manifest.json';
import rd from '@/pages/api/stremio/[userid]/manifest.json';
import rdBare from '@/pages/api/stremio/[userid]/no-catalog/manifest.json';

type Handler = (req: any, res: any) => unknown;
const PROVIDERS: Record<string, [Handler, Handler]> = {
	rd: [rd, rdBare],
	tb: [tb, tbBare],
	ad: [ad, adBare],
	pm: [pm, pmBare],
	oc: [oc, ocBare],
	dl: [dl, dlBare],
	en: [en, enBare],
};

async function logoOf(handler: Handler): Promise<string> {
	const res = createMockResponse();
	await handler(createMockRequest({ query: { userid: 'user1' } }), res);
	return (res._getData() as { logo: string }).logo;
}

describe('DMM Cast add-on logos', () => {
	// Nuvio lists add-ons side by side; five of them shared AllDebrid's yellow robot (2026-11-12).
	it('gives every provider a logo of its own, the same with or without the catalog', async () => {
		const logos: Record<string, string> = {};
		for (const [key, [full, bare]] of Object.entries(PROVIDERS)) {
			logos[key] = await logoOf(full);
			expect(await logoOf(bare), key).toBe(logos[key]);
		}
		expect(new Set(Object.values(logos)).size).toBe(Object.keys(PROVIDERS).length);
	});

	it('ships every logo DMM serves itself', async () => {
		for (const [full] of Object.values(PROVIDERS)) {
			const logo = await logoOf(full);
			const own = logo.match(/^https:\/\/debridmediamanager\.com(\/.+)$/);
			if (own)
				expect(existsSync(path.join(process.cwd(), 'public', own[1])), logo).toBe(true);
		}
	});
});
