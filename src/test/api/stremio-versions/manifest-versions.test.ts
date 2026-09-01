import adManifest from '@/pages/api/stremio-ad/[userid]/manifest.json';
import adNoCatalog from '@/pages/api/stremio-ad/[userid]/no-catalog/manifest.json';
import pmManifest from '@/pages/api/stremio-pm/[userid]/manifest.json';
import pmNoCatalog from '@/pages/api/stremio-pm/[userid]/no-catalog/manifest.json';
import tbManifest from '@/pages/api/stremio-tb/[userid]/manifest.json';
import tbNoCatalog from '@/pages/api/stremio-tb/[userid]/no-catalog/manifest.json';
import rdManifest from '@/pages/api/stremio/[userid]/manifest.json';
import rdNoCatalog from '@/pages/api/stremio/[userid]/no-catalog/manifest.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { CAST_ADDON_VERSIONS } from '@/utils/castAddonVersions';
import { describe, expect, it } from 'vitest';

type Handler = (req: any, res: any) => Promise<void> | void;

const serve = async (handler: Handler) => {
	const res = createMockResponse();
	await handler(createMockRequest({ query: { userid: 'user1' }, headers: {} }), res);
	return res._getData() as { id: string; version: string };
};

const ADDONS: Array<{
	provider: keyof typeof CAST_ADDON_VERSIONS;
	withCatalog: Handler;
	noCatalog: Handler;
}> = [
	{ provider: 'realdebrid', withCatalog: rdManifest, noCatalog: rdNoCatalog },
	{ provider: 'torbox', withCatalog: tbManifest, noCatalog: tbNoCatalog },
	{ provider: 'alldebrid', withCatalog: adManifest, noCatalog: adNoCatalog },
	{ provider: 'premiumize', withCatalog: pmManifest, noCatalog: pmNoCatalog },
];

describe('cast addon manifest versions', () => {
	it.each(ADDONS)('$provider serves the published version', async ({ provider, withCatalog }) => {
		expect((await serve(withCatalog)).version).toBe(CAST_ADDON_VERSIONS[provider]);
	});

	// Both variants of an addon publish under one addon id, so a client that has
	// seen both would otherwise disagree with itself about what is installed.
	it.each(ADDONS)(
		'$provider reports the same version with and without catalogs',
		async ({ withCatalog, noCatalog }) => {
			const a = await serve(withCatalog);
			const b = await serve(noCatalog);
			expect(b.version).toBe(a.version);
		}
	);

	// Stremio only refreshes a stored descriptor when the version moves, so a
	// version that goes backwards or sideways strands every existing install.
	it('publishes a plain incrementing semver for every addon', () => {
		for (const version of Object.values(CAST_ADDON_VERSIONS)) {
			expect(version).toMatch(/^\d+\.\d+\.\d+$/);
		}
	});
});
