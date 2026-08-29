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
				create: input,
				update: {},
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

	describe('releaseRequest', () => {
		it('clears the fulfiller with the failure, since the row is nobody’s again', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.releaseRequest('req-1', 'uploader answered 500');
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1' },
				data: { status: 'failed', fulfillerId: null, error: 'uploader answered 500' },
			});
		});

		it('truncates a long reason to what the column holds', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			await service.releaseRequest('req-1', 'x'.repeat(900));
			const { data } = prisma.contentRequest.updateMany.mock.calls[0][0];
			expect(data.error).toHaveLength(500);
		});
	});

	describe('cancelRequest', () => {
		it('scopes the write to the requester, so an id alone cancels nothing', async () => {
			prisma.contentRequest.updateMany.mockResolvedValue({ count: 1 });
			expect(await service.cancelRequest('req-1', 'asker')).toBe(true);
			expect(prisma.contentRequest.updateMany).toHaveBeenCalledWith({
				where: { id: 'req-1', requesterId: 'asker', status: { in: ['open', 'failed'] } },
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
