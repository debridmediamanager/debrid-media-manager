import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentRequestService } from './contentRequests';

vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn(() => ({
		contentRequest: {
			upsert: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
		$disconnect: vi.fn(),
	})),
}));

const HASH = 'a'.repeat(40);

const row = (over: Record<string, unknown> = {}) => ({
	id: 'req-1',
	hash: HASH,
	imdbId: 'tt1234567',
	title: 'Some Release',
	mediaType: 'movie',
	status: 'open',
	requesterId: 'asker',
	fulfillerId: null,
	jobId: null,
	createdAt: new Date('2026-08-30T00:00:00Z'),
	...over,
});

const input = {
	hash: HASH,
	imdbId: 'tt1234567',
	title: 'Some Release',
	mediaType: 'movie' as const,
	requesterId: 'asker',
};

describe('ContentRequestService', () => {
	let service: ContentRequestService;
	let prisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new ContentRequestService();
		prisma = (service as any).prisma;
	});

	describe('createRequest', () => {
		it('upserts on the release and the asker together', async () => {
			prisma.contentRequest.upsert.mockResolvedValue(row());
			await service.createRequest(input);
			expect(prisma.contentRequest.upsert).toHaveBeenCalledWith({
				where: { hash_requesterId: { hash: HASH, requesterId: 'asker' } },
				create: { ...input, sizeBytes: null },
				update: {},
			});
		});

		it('stores a size as the BigInt the column holds', async () => {
			prisma.contentRequest.upsert.mockResolvedValue(row());
			await service.createRequest({
				...input,
				sizeBytes: 4e9,
				returnPath: '/movie/tt1234567',
			});
			expect(prisma.contentRequest.upsert.mock.calls[0][0].create).toMatchObject({
				sizeBytes: BigInt(4e9),
				returnPath: '/movie/tt1234567',
			});
		});

		it.each(['open', 'failed', 'claimed', 'fulfilled'])(
			'leaves a %s row exactly as it found it',
			async (status) => {
				prisma.contentRequest.upsert.mockResolvedValue(row({ status }));
				const result = await service.createRequest(input);
				expect(result.status).toBe(status);
				// A claimed row dragged back to open would strand the transfer
				// already running against it.
				expect(prisma.contentRequest.updateMany).not.toHaveBeenCalled();
			}
		);

		it('puts a stalled row back on the board when its asker files it again', async () => {
			prisma.contentRequest.upsert.mockResolvedValue(row({ status: 'stalled' }));
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			prisma.contentRequest.findUnique.mockResolvedValue(row({ status: 'open' }));
			const result = await service.createRequest(input);
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'stalled' },
				data: { status: 'open', fulfillerId: null, error: null },
			});
			expect(result.status).toBe('open');
		});

		it('puts a withdrawn row back on the board when it is asked for again', async () => {
			prisma.contentRequest.upsert.mockResolvedValue(row({ status: 'cancelled' }));
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			prisma.contentRequest.findUnique.mockResolvedValue(row({ status: 'open' }));

			const result = await service.createRequest(input);

			// Without this the unique key makes a withdrawn ask permanent: it is the
			// only row that release can ever have for that person, so the second ask
			// would report success and change nothing.
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'cancelled' },
				data: { status: 'open', fulfillerId: null, error: null },
			});
			expect(result.status).toBe('open');
		});

		it('keeps the status in the reopen’s where clause, so a race cannot win twice', async () => {
			prisma.contentRequest.upsert.mockResolvedValue(row({ status: 'cancelled' }));
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 0 });

			const result = await service.createRequest(input);

			// Somebody else moved it between the upsert and the update; the row that
			// came back is returned rather than a second read pretending otherwise.
			expect(prisma.contentRequest.findUnique).not.toHaveBeenCalled();
			expect(result.status).toBe('cancelled');
		});
	});

	describe('claimRequest', () => {
		it('lets the database settle the race by putting the status in the where', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			prisma.contentRequest.findUnique.mockResolvedValue(row({ status: 'claimed' }));

			await service.claimRequest('req-1', 'helper');

			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: { in: ['open', 'failed'] } },
				data: { status: 'claimed', fulfillerId: 'helper', error: null },
			});
		});

		it('returns null to the loser rather than a second claim', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 0 });
			expect(await service.claimRequest('req-1', 'helper')).toBeNull();
			expect(prisma.contentRequest.findUnique).not.toHaveBeenCalled();
		});
	});

	describe('attachJob', () => {
		// Marking the row `fulfilled` here is what hid 322 failed transfers: the
		// job is recorded, and the row waits for it to end.
		it('records the job and leaves the request claimed', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.attachJob('req-1', 'job-9', 'http://debrid02:3100');
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'claimed' },
				data: { jobId: 'job-9', jobHost: 'http://debrid02:3100' },
			});
		});
	});

	describe('settleDelivered', () => {
		it('closes only the claim that job belongs to', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			expect(await service.settleDelivered('req-1', 'job-9')).toBe(true);
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'claimed', jobId: 'job-9' },
				data: { status: 'fulfilled', error: null },
			});
		});
	});

	describe('releaseRequest', () => {
		it('clears the fulfiller with the failure, since the row is nobody’s again', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.releaseRequest('req-1', 'uploader answered 500');
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'claimed' },
				data: { status: 'failed', fulfillerId: null, error: 'uploader answered 500' },
			});
		});

		it('scopes a job failure to that job, so it cannot reopen a later claim', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 0 });
			expect(await service.releaseRequest('req-1', 'uncached', 'job-old')).toBe(false);
			expect(prisma.contentRequest.updateMany.mock.calls[0][0].where).toEqual({
				id: 'req-1',
				status: 'claimed',
				jobId: 'job-old',
			});
		});

		it('truncates a long reason to what the column holds', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.releaseRequest('req-1', 'x'.repeat(900));
			const { data } = prisma.contentRequest.updateMany.mock.calls[0][0];
			expect(data.error).toHaveLength(500);
		});
	});

	describe('stallRequest', () => {
		it('takes a claim off the board with the reason', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.stallRequest('req-1', 'no credentials');
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'claimed' },
				data: { status: 'stalled', fulfillerId: null, error: 'no credentials' },
			});
		});
	});

	describe('returnClaim', () => {
		it('puts a claim back as open without recording a failure', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.returnClaim('req-1');
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', status: 'claimed' },
				data: { status: 'open', fulfillerId: null },
			});
		});
	});

	describe('cancelRequest', () => {
		it('scopes the write to the requester, so an id alone cancels nothing', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			expect(await service.cancelRequest('req-1', 'asker')).toBe(true);
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: {
					id: 'req-1',
					requesterId: 'asker',
					status: { in: ['open', 'failed', 'stalled'] },
				},
				data: { status: 'cancelled' },
			});
		});

		it('reports false when the row was somebody else’s or already taken', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 0 });
			expect(await service.cancelRequest('req-1', 'stranger')).toBe(false);
		});
	});

	describe('listing', () => {
		it('shows open and failed rows oldest first, tie-broken by id, so nothing starves', async () => {
			prisma.contentRequest.findMany.mockResolvedValue([]);
			await service.listOpenRequests(50);
			expect(prisma.contentRequest.findMany).toHaveBeenCalledWith({
				where: { status: { in: ['open', 'failed'] } },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				take: 50,
				skip: 0,
			});
		});

		it('skips by the offset the page passes, keeping the same order', async () => {
			prisma.contentRequest.findMany.mockResolvedValue([]);
			await service.listOpenRequests(25, 50);
			expect(prisma.contentRequest.findMany).toHaveBeenCalledWith({
				where: { status: { in: ['open', 'failed'] } },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				take: 25,
				skip: 50,
			});
		});

		it('shows one person their own asks newest first, in any state', async () => {
			prisma.contentRequest.findMany.mockResolvedValue([]);
			await service.listRequestsFor('asker', 20);
			expect(prisma.contentRequest.findMany).toHaveBeenCalledWith({
				where: { requesterId: 'asker' },
				orderBy: { createdAt: 'desc' },
				take: 20,
			});
		});
	});
});
