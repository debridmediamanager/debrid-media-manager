import type * as AllDebrid from '@/services/allDebrid';
import regressed from '@/test/fixtures/allDebridAvailable/regressed-magnet-2026-11-05.json';
import uploads from '@/test/fixtures/allDebridRestore/upload-ready-and-not-2026-11-04.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/allDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof AllDebrid>()),
	getMagnetStatus: vi.fn(),
	uploadMagnetAd: vi.fn(),
	getMagnetStatusAd: vi.fn(),
	getMagnetFiles: vi.fn(),
	deleteMagnetAd: vi.fn(),
}));
vi.mock('@/utils/delay', () => ({ delay: vi.fn(async () => {}) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import {
	deleteMagnetAd,
	getMagnetFiles,
	getMagnetStatus,
	getMagnetStatusAd,
	uploadMagnetAd,
} from '@/services/allDebrid';
import { handleAddAsMagnetInAd } from './addMagnet';

const owned = regressed.ad_magnet_status_regressed.body.data.magnets;
const notReadyUpload = uploads.uploads.find((upload) => !upload.ready)!;

describe('AllDebrid add probe ownership', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMagnetStatus).mockResolvedValue({ status: 'success', data: { magnets: [] } });
		vi.mocked(uploadMagnetAd).mockResolvedValue({
			...notReadyUpload,
			id: owned.id,
			hash: owned.hash,
		});
		vi.mocked(getMagnetStatusAd).mockResolvedValue({ ...owned, links: [] });
		vi.mocked(getMagnetFiles).mockResolvedValue({ magnets: [] });
	});

	it('keeps an already-owned downloading magnet when duplicate upload reuses its id', async () => {
		vi.mocked(getMagnetStatus).mockResolvedValue({
			status: 'success',
			data: { magnets: [{ ...owned, links: [] }] },
		});
		await expect(
			handleAddAsMagnetInAd('key', owned.hash.toUpperCase(), undefined, true, true, true)
		).resolves.toBe('not_cached');
		expect(deleteMagnetAd).not.toHaveBeenCalled();
		expect(getMagnetStatus).toHaveBeenCalledWith('key');
		expect(vi.mocked(getMagnetStatus).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(uploadMagnetAd).mock.invocationCallOrder[0]
		);
	});

	it('keeps an owned Ready magnet after an availability-only check', async () => {
		vi.mocked(getMagnetStatus).mockResolvedValue({
			status: 'success',
			data: { magnets: [{ ...owned, links: [] }] },
		});
		vi.mocked(uploadMagnetAd).mockResolvedValue({
			...notReadyUpload,
			id: owned.id,
			ready: true,
		});
		vi.mocked(getMagnetStatusAd).mockResolvedValue({
			...owned,
			status: 'Ready',
			statusCode: 4,
			links: [],
		});
		await handleAddAsMagnetInAd('key', owned.hash, undefined, true, false, true);
		expect(deleteMagnetAd).not.toHaveBeenCalled();
	});

	it('cleans up a newly-created uncached probe', async () => {
		await expect(
			handleAddAsMagnetInAd('key', owned.hash, undefined, true, true, true)
		).resolves.toBe('not_cached');
		expect(deleteMagnetAd).toHaveBeenCalledWith('key', owned.id);
	});

	it('cleans up a newly-created Ready availability probe', async () => {
		vi.mocked(uploadMagnetAd).mockResolvedValue({
			...notReadyUpload,
			id: owned.id,
			ready: true,
		});
		await handleAddAsMagnetInAd('key', owned.hash, undefined, false, false, true);
		expect(deleteMagnetAd).toHaveBeenCalledWith('key', owned.id);
	});

	it('does not upload or delete when the ownership precheck fails', async () => {
		vi.mocked(getMagnetStatus).mockRejectedValue(new Error('Temporarily unavailable'));
		await expect(
			handleAddAsMagnetInAd('key', owned.hash, undefined, true, true, true)
		).rejects.toThrow('Temporarily unavailable');
		expect(uploadMagnetAd).not.toHaveBeenCalled();
		expect(deleteMagnetAd).not.toHaveBeenCalled();
	});

	it('does not upload against an unavailable list baseline', async () => {
		// @ts-expect-error Deliberately model an incomplete provider response.
		vi.mocked(getMagnetStatus).mockResolvedValue({ status: 'success', data: {} });
		await expect(
			handleAddAsMagnetInAd('key', owned.hash, undefined, true, true, true)
		).rejects.toThrow();
		expect(uploadMagnetAd).not.toHaveBeenCalled();
		expect(deleteMagnetAd).not.toHaveBeenCalled();
	});
});
