import { JEV_REPORTER } from '@/services/reporterId';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ReportService } from './report';

const prismaMock = vi.hoisted(() => ({
	report: {
		upsert: vi.fn(),
		findMany: vi.fn(),
	},
	scraped: {
		findMany: vi.fn(),
	},
	reportDecision: {
		findMany: vi.fn(),
		createMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('ReportService', () => {
	let service: ReportService;

	beforeEach(() => {
		service = new ReportService();
		(prismaMock.report.upsert as Mock).mockReset();
		(prismaMock.report.findMany as Mock).mockReset();
		(prismaMock.scraped.findMany as Mock).mockReset();
		(prismaMock.reportDecision.findMany as Mock).mockReset();
	});

	it('creates or updates reports', async () => {
		await service.reportContent('hash', 'tt1', 'user', 'porn');
		expect(prismaMock.report.upsert).toHaveBeenCalledWith({
			where: {
				hash_userId: {
					hash: 'hash',
					userId: 'user',
				},
			},
			update: expect.objectContaining({ type: 'porn' }),
			create: expect.objectContaining({ imdbId: 'tt1', userId: 'user' }),
		});
	});

	it('stores the hash in lower case, the case every reader compares in', async () => {
		const upper = 'F8EF3C52E093EE9AAF8E7D047596ED96A0A37C40';
		await service.reportContent(upper, 'tt1', 'user', 'porn');
		const [{ where, create }] = prismaMock.report.upsert.mock.calls[0];
		expect(where.hash_userId.hash).toBe(upper.toLowerCase());
		expect(create.hash).toBe(upper.toLowerCase());
	});

	it('propagates database errors when saving a report fails', async () => {
		prismaMock.report.upsert.mockRejectedValue(new Error('db down'));
		await expect(service.reportContent('hash', 'tt1', 'user', 'porn')).rejects.toThrow(
			'Failed to save report: db down'
		);
	});

	it('returns imdb ids with empty scraped entries', async () => {
		prismaMock.scraped.findMany.mockResolvedValue([
			{ key: 'movie:tt123' },
			{ key: 'tv:tt456' },
		]);

		const ids = await service.getEmptyMedia(2);
		expect(ids).toEqual(['tt123', 'tt456']);

		prismaMock.scraped.findMany.mockResolvedValue([]);
		expect(await service.getEmptyMedia(1)).toBeNull();
	});

	// Reports used to hide a release on their own (two reporters, or Jev agreeing);
	// since 2026-11-11 only an admin's approval at /admin/reports does.
	it('hides only the releases an admin approved for that title', async () => {
		prismaMock.reportDecision.findMany.mockResolvedValue([{ hash: 'approved-hash' }]);
		prismaMock.report.findMany.mockResolvedValue([
			{ hash: 'jev-hash', userId: JEV_REPORTER },
			{ hash: 'multi', userId: 'user-1' },
			{ hash: 'multi', userId: 'user-2' },
		]);

		expect(await service.getReportedHashes('tt1')).toEqual(['approved-hash']);
		expect(prismaMock.reportDecision.findMany).toHaveBeenCalledWith({
			where: { imdbId: 'tt1', decision: 'approved' },
			select: { hash: true },
		});
	});

	it('hides nothing for a title with reports but no approval', async () => {
		prismaMock.reportDecision.findMany.mockResolvedValue([]);
		prismaMock.report.findMany.mockResolvedValue([
			{ hash: 'multi', userId: 'user-1' },
			{ hash: 'multi', userId: 'user-2' },
			{ hash: 'jev-hash', userId: JEV_REPORTER },
		]);
		expect(await service.getReportedHashes('tt1')).toEqual([]);
	});

	it('throws when report lookups fail', async () => {
		prismaMock.reportDecision.findMany.mockRejectedValue(new Error('db down'));
		await expect(service.getReportedHashes('tt1')).rejects.toThrow(
			'Failed to get reported hashes: db down'
		);
	});

	it('hides automatically only what nobody decided yet', async () => {
		prismaMock.reportDecision.createMany.mockResolvedValue({ count: 1 });
		expect(
			await service.approveUndecided([{ imdbId: 'tt1', hash: 'aa' }], 'model confirmed')
		).toBe(1);
		expect(prismaMock.reportDecision.createMany).toHaveBeenCalledWith({
			data: [{ imdbId: 'tt1', hash: 'aa', decision: 'approved', note: 'model confirmed' }],
			// an admin's earlier "keep" stays
			skipDuplicates: true,
		});
	});
});
