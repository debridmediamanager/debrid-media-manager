import { repository as db } from '@/services/repository';
import { alreadyOnRealDebrid, deliverFreeRequests } from '@/services/requestDelivery';
import fixture from '@/test/fixtures/contentRequests/free-delivery.json';
import { castAccessToken } from '@/utils/castRdToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/castRdToken', () => ({ castAccessToken: vi.fn() }));

const mockDb = vi.mocked(db);
const { cachedOnRd, transferredLive, transferredPruned } = fixture;

const available = new Set([
	...cachedOnRd.available,
	...transferredLive.available,
	...transferredPruned.available,
]);
const transfers = [transferredLive.transfer, transferredPruned.transfer];

const openRow = (
	request: { hash: string; imdbId: string; title: string; mediaType: string },
	id: string
) => ({
	id,
	...request,
	status: 'open',
	requesterId: `asker-${id}`,
	fulfillerId: null,
	jobId: null,
	createdAt: new Date('2026-09-10T00:00:00Z'),
});

/** Real-Debrid's addMagnet then selectFiles, recording what was added. */
const rdAdds: string[] = [];
const stubRd = (addStatus = 201) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			if (url.endsWith('/torrents/addMagnet')) {
				rdAdds.push(decodeURIComponent(String(init.body)).split('btih:')[1]);
				return { status: addStatus, json: async () => ({ id: 'RDID' }) };
			}
			return { status: 204, json: async () => ({}) };
		})
	);

beforeEach(() => {
	vi.clearAllMocks();
	rdAdds.length = 0;
	mockDb.checkAvailabilityByHashes = vi.fn(async (hashes: string[]) =>
		hashes.filter((h) => available.has(h)).map((hash) => ({ hash, files: [] }))
	) as any;
	mockDb.getDebridTransfers = vi.fn(async (hashes: string[]) =>
		transfers.filter((t) => hashes.includes(t.originalHash))
	) as any;
	mockDb.getCastProfile = vi.fn().mockResolvedValue({ userId: 'x' }) as any;
	mockDb.markContentRequestDelivered = vi.fn().mockResolvedValue(true);
	vi.mocked(castAccessToken).mockResolvedValue('MINTED');
	stubRd();
});

describe('alreadyOnRealDebrid', () => {
	it('finds a release RD has cached, and one an earlier transfer put there', async () => {
		const result = await alreadyOnRealDebrid([
			cachedOnRd.request.hash,
			transferredLive.request.hash,
			transferredPruned.request.hash,
		]);
		expect(result).toEqual(
			new Map([
				[cachedOnRd.request.hash, cachedOnRd.request.hash],
				// The rewritten hash, since that is what RD holds.
				[transferredLive.request.hash, transferredLive.transfer.rewrittenHash],
			])
		);
	});
});

describe('deliverFreeRequests', () => {
	// On 2026-09-24 these sat on the board waiting for a fulfiller who would have
	// spent TorBox quota on something one addMagnet delivers.
	it('adds what is already on RD to each asker and closes their request', async () => {
		mockDb.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([
				openRow(cachedOnRd.request, 'r1'),
				openRow(transferredLive.request, 'r2'),
				openRow(transferredPruned.request, 'r3'),
			]);

		const result = await deliverFreeRequests();

		expect(rdAdds).toEqual([cachedOnRd.request.hash, transferredLive.transfer.rewrittenHash]);
		expect(mockDb.getCastProfile).toHaveBeenCalledWith('asker-r1');
		expect(mockDb.markContentRequestDelivered).toHaveBeenCalledWith('r1');
		expect(mockDb.markContentRequestDelivered).toHaveBeenCalledWith('r2');
		expect(mockDb.markContentRequestDelivered).not.toHaveBeenCalledWith('r3');
		expect(result).toEqual({ delivered: 2, skipped: 0 });
	});

	it('leaves a request open when Real-Debrid refuses the add', async () => {
		stubRd(403);
		mockDb.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([openRow(cachedOnRd.request, 'r1')]);
		const result = await deliverFreeRequests();
		expect(mockDb.markContentRequestDelivered).not.toHaveBeenCalled();
		expect(result).toEqual({ delivered: 0, skipped: 1 });
	});

	it('leaves a request open when the asker has no stored credentials', async () => {
		mockDb.getCastProfile = vi.fn().mockResolvedValue(null) as any;
		mockDb.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([openRow(cachedOnRd.request, 'r1')]);
		await deliverFreeRequests();
		expect(rdAdds).toEqual([]);
		expect(mockDb.markContentRequestDelivered).not.toHaveBeenCalled();
	});

	it('stops at the batch size', async () => {
		mockDb.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([
				openRow(cachedOnRd.request, 'r1'),
				openRow(transferredLive.request, 'r2'),
			]);
		const result = await deliverFreeRequests(1);
		expect(result.delivered).toBe(1);
		expect(rdAdds).toHaveLength(1);
	});
});
