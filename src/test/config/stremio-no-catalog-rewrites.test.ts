import { describe, expect, it } from 'vitest';

/**
 * The no-catalog addon variants are one manifest route plus a rewrite that
 * folds every other path back onto the main handlers. Premiumize shipped
 * without the rewrite, so its no-catalog install 404'd on every stream.
 */
describe('no-catalog rewrites', () => {
	const providers = ['stremio', 'stremio-tb', 'stremio-ad', 'stremio-pm'];

	it.each(providers)('%s folds no-catalog paths back onto the addon', async (provider) => {
		const config = await import('../../../next.config.js');
		const { fallback } = await ((config as any).default ?? config).rewrites();

		expect(fallback).toContainEqual({
			source: `/api/${provider}/:userid/no-catalog/:path*`,
			destination: `/api/${provider}/:userid/:path*`,
		});
	});
});
