import handler, { debridLinkCastManifest } from '@/pages/api/stremio-dl/[userid]/manifest.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { describe, expect, it } from 'vitest';

describe('/api/stremio-dl/[userid]/manifest.json', () => {
	it('advertises the library catalog and the meta that backs it', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');

		const manifest = res._getData() as any;
		expect(manifest.types).toContain('other');
		expect(manifest.catalogs).toContainEqual({
			id: 'dl-casted-other',
			name: 'DMM DL Library',
			type: 'other',
			extra: [{ name: 'skip' }],
		});
		// Without the meta resource Stremio renders the tiles and opens none of them.
		expect(manifest.resources).toContainEqual({
			name: 'meta',
			types: ['other'],
			idPrefixes: ['dmm-dl'],
		});
	});

	it('leaves the library out of the no-catalog variant', () => {
		const manifest = debridLinkCastManifest(false);
		expect(manifest.catalogs).toEqual([]);
		expect(manifest.types).not.toContain('other');
		expect(JSON.stringify(manifest.resources)).not.toContain('meta');
	});

	// The two variants must not share an addon id, or Stremio cannot hold both.
	it('gives the no-catalog variant its own addon id', () => {
		expect(debridLinkCastManifest(false).id).not.toBe(debridLinkCastManifest(true).id);
	});
});
