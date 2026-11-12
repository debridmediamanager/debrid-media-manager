import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ad = vi.hoisted(() => ({
	uploadMagnet: vi.fn(),
	getMagnetLinks: vi.fn(),
	unlockLink: vi.fn(),
	deleteMagnet: vi.fn(async () => ({ message: 'ok' })),
}));
vi.mock('@/services/allDebrid', () => ad);

import { lookInsideAllDebrid, playableLink } from '@/utils/adminAllDebrid';

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

beforeEach(() => {
	localStorage.clear();
	Object.values(ad).forEach((fn) => fn.mockClear());
});
afterEach(() => vi.useRealTimers());

describe('looking inside through AllDebrid from the browser', () => {
	it('lists a cached release biggest first and remembers the magnet for later cleanup', async () => {
		ad.uploadMagnet.mockResolvedValue({ magnets: [{ id: 42, ready: true, magnet: '' }] });
		ad.getMagnetLinks.mockResolvedValue([
			{ filename: 'sample.mkv', size: 5, link: 'https://alldebrid.com/f/s', files: [] },
			{ filename: 'Movie.mkv', size: 900, link: 'https://alldebrid.com/f/m', files: [] },
		]);
		expect(await lookInsideAllDebrid('ADKEY', HASH)).toEqual({
			cached: true,
			files: [
				{ path: 'Movie.mkv', size: 900, link: 'https://alldebrid.com/f/m' },
				{ path: 'sample.mkv', size: 5, link: 'https://alldebrid.com/f/s' },
			],
		});
		expect(ad.uploadMagnet).toHaveBeenCalledWith('ADKEY', [HASH]);
		expect(ad.deleteMagnet).not.toHaveBeenCalled();
		expect(JSON.parse(localStorage.getItem('dmm:adminAllDebridMagnets')!)).toEqual([
			{ id: 42, at: expect.any(Number) },
		]);
	});

	it('removes an uncached magnet at once', async () => {
		ad.uploadMagnet.mockResolvedValue({ magnets: [{ id: 7, ready: false, magnet: '' }] });
		expect(await lookInsideAllDebrid('ADKEY', HASH)).toEqual({ cached: false, files: [] });
		expect(ad.deleteMagnet).toHaveBeenCalledWith('ADKEY', '7');
		expect(ad.getMagnetLinks).not.toHaveBeenCalled();
	});

	it('deletes the magnets it added more than six hours ago before adding another', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
		localStorage.setItem(
			'dmm:adminAllDebridMagnets',
			JSON.stringify([
				{ id: 1, at: Date.parse('2026-11-12T05:00:00Z') },
				{ id: 2, at: Date.parse('2026-11-12T11:00:00Z') },
			])
		);
		ad.uploadMagnet.mockResolvedValue({ magnets: [{ id: 3, ready: false, magnet: '' }] });
		await lookInsideAllDebrid('ADKEY', HASH);
		expect(ad.deleteMagnet.mock.calls.map((c) => (c as unknown as string[])[1])).toEqual([
			'1',
			'3',
		]);
		expect(
			JSON.parse(localStorage.getItem('dmm:adminAllDebridMagnets')!).map(
				(m: { id: number }) => m.id
			)
		).toEqual([2]);
	});

	it('turns a file link into a playable one only when asked', async () => {
		ad.unlockLink.mockResolvedValue({ link: 'https://cdn.alldebrid/movie.mkv' });
		expect(await playableLink('ADKEY', 'https://alldebrid.com/f/m')).toBe(
			'https://cdn.alldebrid/movie.mkv'
		);
		expect(ad.unlockLink).toHaveBeenCalledWith('ADKEY', 'https://alldebrid.com/f/m');
	});
});
