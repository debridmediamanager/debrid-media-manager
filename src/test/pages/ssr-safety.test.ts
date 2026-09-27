import { describe, it, vi } from 'vitest';

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			traktClientId: 'test-client-id',
		},
	}),
}));

const importWithoutWindow = async (modulePath: string) => {
	vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis);
	try {
		await import(modulePath);
	} finally {
		vi.unstubAllGlobals();
	}
};

describe('SSR safety', () => {
	it('movie page can load when window is undefined', async () => {
		await importWithoutWindow('@/pages/movie/[imdbid]/index.tsx');
	});

	it('show page can load when window is undefined', async () => {
		await importWithoutWindow('@/pages/show/[imdbid]/[seasonNum].tsx');
	});

	it('anime page can load when window is undefined', async () => {
		await importWithoutWindow('@/pages/anime/[anidbid].tsx');
	});
});
