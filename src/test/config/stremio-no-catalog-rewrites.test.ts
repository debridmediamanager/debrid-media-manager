import { describe, expect, it } from 'vitest';
import loadConfig from '../../../next.config.js';

/**
 * The no-catalog addon variants are one manifest route plus a rewrite that
 * folds every other path back onto the main handlers. Premiumize shipped
 * without the rewrite, so its no-catalog install 404'd on every stream.
 */
describe('no-catalog rewrites', () => {
	const providers = [
		'stremio',
		'stremio-tb',
		'stremio-ad',
		'stremio-pm',
		'stremio-oc',
		'stremio-dl',
	];

	it.each(providers)('%s folds no-catalog paths back onto the addon', async (provider) => {
		const config = await loadConfig();
		if (!config.rewrites) throw new Error('Expected Next rewrite configuration');
		const rewrites = await config.rewrites();
		if (Array.isArray(rewrites) || !rewrites.fallback) {
			throw new Error('Expected fallback rewrites for no-catalog addons');
		}
		const { fallback } = rewrites;

		expect(fallback).toContainEqual({
			source: `/api/${provider}/:userid/no-catalog/:path*`,
			destination: `/api/${provider}/:userid/:path*`,
		});
	});
});
