import adManifest from '@/pages/api/stremio-ad/[userid]/manifest.json';
import dlManifest from '@/pages/api/stremio-dl/[userid]/manifest.json';
import dlNoCatalogManifest from '@/pages/api/stremio-dl/[userid]/no-catalog/manifest.json';
import ocManifest from '@/pages/api/stremio-oc/[userid]/manifest.json';
import ocNoCatalogManifest from '@/pages/api/stremio-oc/[userid]/no-catalog/manifest.json';
import pmManifest from '@/pages/api/stremio-pm/[userid]/manifest.json';
import pmNoCatalogManifest from '@/pages/api/stremio-pm/[userid]/no-catalog/manifest.json';
import tbManifest from '@/pages/api/stremio-tb/[userid]/manifest.json';
import rdManifest from '@/pages/api/stremio/[userid]/manifest.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { describe, expect, it } from 'vitest';

const manifests = [
	{ name: 'Real-Debrid', handler: rdManifest },
	{ name: 'AllDebrid', handler: adManifest },
	{ name: 'TorBox', handler: tbManifest },
	{ name: 'Premiumize', handler: pmManifest },
	{ name: 'Offcloud', handler: ocManifest },
	{ name: 'Debrid-Link', handler: dlManifest },
] as const;

const noCatalogManifests = [
	{ name: 'Premiumize', handler: pmNoCatalogManifest },
	{ name: 'Offcloud', handler: ocNoCatalogManifest },
	{ name: 'Debrid-Link', handler: dlNoCatalogManifest },
] as const;

const render = async (handler: (typeof manifests)[number]['handler']) => {
	const res = createMockResponse();
	await handler(createMockRequest({ query: { userid: 'user123' } }), res);
	return res._getData() as any;
};

describe('DMM Cast manifests', () => {
	/**
	 * `resources` is the authoritative list of what an addon serves. Stremio's
	 * own clients get away with it missing because stremio-core matches catalog
	 * requests against `catalogs` instead, but clients that read the spec skip
	 * catalogs entirely when `catalog` is absent.
	 */
	it.each(manifests)('$name declares the catalog resource it serves', async ({ handler }) => {
		const data = await render(handler);

		expect(data.catalogs.length).toBeGreaterThan(0);
		expect(data.resources).toContain('catalog');
	});

	it.each(manifests)('$name advertises skip on every catalog', async ({ handler }) => {
		const data = await render(handler);

		for (const catalog of data.catalogs) {
			expect(catalog.extra).toContainEqual({ name: 'skip' });
		}
	});

	it.each(noCatalogManifests)(
		'the $name no-catalog variant claims neither catalogs nor the resource',
		async ({ handler }) => {
			const data = await render(handler);

			expect(data.catalogs).toEqual([]);
			expect(data.resources).not.toContain('catalog');
		}
	);
});
