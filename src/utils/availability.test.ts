import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkAvailability,
	checkAvailabilityByHashes,
	removeAvailability,
	submitAvailability,
} from './availability';

const ok = (data: any) => ({ ok: true, json: vi.fn(async () => data) }) as any;
const fail = (data: any) => ({ ok: false, json: vi.fn(async () => data) }) as any;

describe('availability client utils', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('checkAvailability filters invalid hashes and short-circuits', async () => {
		const res = await checkAvailability('k', 's', 'tt123', ['bad', 'also-bad']);
		expect(res).toEqual({ available: [] });
	});

	it('checkAvailability posts valid hashes and returns JSON', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch' as any)
			.mockResolvedValue(ok({ available: ['hash'] }));
		const res = await checkAvailability('k', 's', 'tt123', [
			'abcdef0123456789abcdef0123456789abcdef01',
		]);
		expect(fetchMock).toHaveBeenCalled();
		expect(res).toEqual({ available: ['hash'] });
	});

	it('checkAvailability surfaces error details from server', async () => {
		vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
			fail({ error: 'Bad request', hash: 'deadbeef' })
		);
		await expect(
			checkAvailability('k', 's', 'tt123', ['abcdef0123456789abcdef0123456789abcdef01'])
		).rejects.toThrow(/Bad request|Failed to check availability/);
	});

	it('checkAvailabilityByHashes posts to alternative route', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch' as any)
			.mockResolvedValue(ok({ available: ['hash2'] }));
		const res = await checkAvailabilityByHashes('k', 's', [
			'abcdef0123456789abcdef0123456789abcdef01',
		]);
		expect(fetchMock).toHaveBeenCalled();
		expect(res).toEqual({ available: ['hash2'] });
	});

	it('submitAvailability sends the torrent id, not the torrent', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch' as any)
			.mockResolvedValue(ok({ success: true }));
		const resp = await submitAvailability('k', 's', 'RDKEY', 'TORRENT1', 'tt123');
		// only the token and the torrent id travel: DMM reads the torrent from RD
		const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
		expect(sent).toEqual({
			rdKey: 'RDKEY',
			torrentId: 'TORRENT1',
			imdbId: 'tt123',
			dmmProblemKey: 'k',
			solution: 's',
		});
		expect(resp).toEqual({ success: true });
	});

	it('removeAvailability posts and returns JSON', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch' as any)
			.mockResolvedValue(ok({ removed: true }));
		const resp = await removeAvailability(
			'k',
			's',
			'abcdef0123456789abcdef0123456789abcdef01',
			'reason'
		);
		expect(fetchMock).toHaveBeenCalled();
		expect(resp).toEqual({ removed: true });
	});
});
