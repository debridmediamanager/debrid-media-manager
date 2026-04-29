import { beforeAll, describe, expect, it } from 'vitest';

type PwaConfig = {
	buildExcludes?: unknown[];
	cacheOnFrontEndNav?: boolean;
	fallbacks?: Record<string, unknown>;
	runtimeCaching?: Array<Record<string, any>>;
};

const loadConfig = async (): Promise<PwaConfig> => {
	const configModule = await import('../../../pwa.config.js');
	return (configModule as any).default ?? configModule;
};

describe('next-pwa configuration', () => {
	let pwaConfig: PwaConfig;

	beforeAll(async () => {
		pwaConfig = await loadConfig();
	});

	describe('buildExcludes - dynamic css manifest', () => {
		const pathVariants = [
			'dynamic-css-manifest.json',
			'static/css/dynamic-css-manifest.json',
			'_next/dynamic-css-manifest.json',
			'/_next/dynamic-css-manifest.json',
		];

		it.each(pathVariants)('excludes dynamic css manifest at path: %s', (path) => {
			const buildExcludes = pwaConfig.buildExcludes ?? [];
			const excluded = buildExcludes.some((entry) => {
				if (entry instanceof RegExp) {
					return entry.test(path);
				}
				return false;
			});
			expect(excluded).toBe(true);
		});

		it('does not exclude unrelated json files', () => {
			const buildExcludes = pwaConfig.buildExcludes ?? [];
			const excluded = buildExcludes.some((entry) => {
				if (entry instanceof RegExp) {
					return entry.test('_buildManifest.js');
				}
				return false;
			});
			expect(excluded).toBe(false);
		});
	});

	it('enables cache for client navigation', () => {
		expect(pwaConfig.cacheOnFrontEndNav).toBe(true);
	});

	it('limits poster runtime cache size', () => {
		const runtimeCaching = pwaConfig.runtimeCaching ?? [];
		const posterCache = runtimeCaching.find(
			(entry) => entry?.options?.cacheName === 'poster-images'
		);
		expect(posterCache?.options?.expiration?.maxEntries).toBeGreaterThan(0);
	});

	it('registers offline fallback document', () => {
		expect(pwaConfig.fallbacks?.document).toBe('/_offline');
	});
});
