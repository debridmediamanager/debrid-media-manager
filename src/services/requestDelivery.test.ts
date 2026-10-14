import { repository as db } from '@/services/repository';
import { alreadyOnRealDebrid, deliverFreeRequests } from '@/services/requestDelivery';
import fixture from '@/test/fixtures/contentRequests/free-delivery.json';
import retest from '@/test/fixtures/realdebrid/rd-add-name-retest-2026-10-13.json';
import { castAccessToken } from '@/utils/castRdToken';
import { deInfringe } from '@/utils/deInfringe';
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

// A release RD refused by name on 2026-10-13 and again an hour later, held in
// DMM's availability table under that name.
const refusedByName = retest.adds.find(
	(a) => a.pass === 1 && a.hash === '4d2e9e41c6dd2d2183888b90d5393d7ae472f1b6'
)!;
const refusedRequest = {
	hash: refusedByName.hash,
	imdbId: 'tt31193180',
	title: refusedByName.title,
	mediaType: 'movie',
};

/** The name on each Available row: RD's own, or the uploader's rewrite. */
const rowNames = new Map<string, string>([
	[cachedOnRd.request.hash, cachedOnRd.request.title],
	[transferredLive.transfer.rewrittenHash, deInfringe(transferredLive.request.title)],
	[transferredPruned.transfer.rewrittenHash, deInfringe(transferredPruned.request.title)],
	[refusedByName.hash, refusedByName.title],
]);
const onRd = (h: string) => available.has(h) || h === refusedByName.hash;

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
		hashes.filter(onRd).map((hash) => ({ hash, files: [] }))
	) as any;
	mockDb.getCachedRdNames = vi.fn(
		async (hashes: string[]) =>
			new Map(
				hashes.filter(onRd).map((hash) => {
					const name = rowNames.get(hash)!;
					return [hash, { filename: name, originalFilename: name }];
				})
			)
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

describe('a release RD refuses by name', () => {
	it('is not called already on RD, so the transfer route lands it under a name RD takes', async () => {
		expect(await alreadyOnRealDebrid([refusedRequest.hash])).toEqual(new Map());
	});

	it('is not added to the asker, whose request stays open', async () => {
		mockDb.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([openRow(refusedRequest, 'r9'), openRow(cachedOnRd.request, 'r1')]);

		const result = await deliverFreeRequests();

		expect(rdAdds).toEqual([cachedOnRd.request.hash]);
		expect(mockDb.markContentRequestDelivered).not.toHaveBeenCalledWith('r9');
		expect(result).toEqual({ delivered: 1, skipped: 0 });
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
