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

	it('aggregates reported hashes using the filtering rules', async () => {
		prismaMock.report.findMany.mockResolvedValue([
			{ hash: 'admin-hash', userId: JEV_REPORTER },
			{ hash: 'multi', userId: 'user-1' },
			{ hash: 'multi', userId: 'user-2' },
			{ hash: 'single', userId: 'user-1' },
		]);

		const hashes = await service.getReportedHashes('tt1');
		expect(hashes).toEqual(expect.arrayContaining(['admin-hash', 'multi']));
		expect(hashes).not.toContain('single');
	});

	it('never lets a client-sent reporter id hide a result on its own', async () => {
		// The old moderator id was compared in the public source, so anyone could
		// send it. A client's id is what verifiedReporterId files, never JEV_REPORTER.
		const sent = ['jev', 'admin', 'pm:x', 'rd:account', 'A'.repeat(52)];
		prismaMock.report.findMany.mockResolvedValue(
			sent.map((id, i) => ({ hash: `h${i}`, userId: id }))
		);

		expect(await service.getReportedHashes('tt1')).toEqual([]);
	});

	it('throws when report lookups fail', async () => {
		prismaMock.report.findMany.mockRejectedValue(new Error('db down'));
		await expect(service.getReportedHashes('tt1')).rejects.toThrow(
			'Failed to get reported hashes: db down'
		);
	});
});
