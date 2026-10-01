import { DatabaseClient } from './client';

export type TakedownStatus = 'pending' | 'approved' | 'rejected';

export type NewTakedownNotice = {
	claimantName: string;
	claimantEmail: string;
	representing: string | null;
	work: string;
	reason: string;
	locations: string;
	hashes: string[];
	releases: string[];
	hashlistIds: string[];
	submitterIp: string | null;
};

export type TakedownNoticeRow = NewTakedownNotice & {
	id: string;
	status: TakedownStatus;
	reviewNote: string | null;
	reviewedAt: Date | null;
	createdAt: Date;
};

const asStrings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const toRow = (row: any): TakedownNoticeRow => ({
	...row,
	hashes: asStrings(row.hashes),
	releases: asStrings(row.releases),
	hashlistIds: asStrings(row.hashlistIds),
});

export class TakedownService extends DatabaseClient {
	public async createNotice(notice: NewTakedownNotice): Promise<string> {
		const row = await this.prisma.takedownNotice.create({
			data: notice,
			select: { id: true },
		});
		return row.id;
	}

	public async getNotice(id: string): Promise<TakedownNoticeRow | null> {
		const row = await this.prisma.takedownNotice.findUnique({ where: { id } });
		return row ? toRow(row) : null;
	}

	public async listNotices(status?: TakedownStatus, take = 200): Promise<TakedownNoticeRow[]> {
		const rows = await this.prisma.takedownNotice.findMany({
			where: status ? { status } : undefined,
			orderBy: { createdAt: 'desc' },
			take,
		});
		return rows.map(toRow);
	}

	/**
	 * Blocks everything the notice names. A hash already blocked by an earlier
	 * notice keeps that notice as its owner; rejectNotice hands ownership on
	 * when it reverses one, so an overlap never unblocks what another approval
	 * still covers.
	 */
	public async approveNotice(id: string, reviewNote: string | null): Promise<TakedownNoticeRow> {
		return this.prisma.$transaction(async (tx) => {
			const notice = await tx.takedownNotice.findUnique({ where: { id } });
			if (!notice) throw new Error('Notice not found');
			const { hashes, releases } = toRow(notice);
			if (hashes.length > 0) {
				await tx.blockedHash.createMany({
					data: hashes.map((hash) => ({ hash, noticeId: id })),
					skipDuplicates: true,
				});
			}
			if (releases.length > 0) {
				await tx.blockedRelease.createMany({
					data: releases.map((name) => ({ name, noticeId: id })),
					skipDuplicates: true,
				});
			}
			const updated = await tx.takedownNotice.update({
				where: { id },
				data: { status: 'approved', reviewNote, reviewedAt: new Date() },
			});
			return toRow(updated);
		});
	}

	/** Rejects a pending notice, or reverses an approved one. */
	public async rejectNotice(id: string, reviewNote: string | null): Promise<TakedownNoticeRow> {
		return this.prisma.$transaction(async (tx) => {
			const [ownedHashes, ownedReleases] = await Promise.all([
				tx.blockedHash.findMany({ where: { noticeId: id }, select: { hash: true } }),
				tx.blockedRelease.findMany({ where: { noticeId: id }, select: { name: true } }),
			]);
			await tx.blockedHash.deleteMany({ where: { noticeId: id } });
			await tx.blockedRelease.deleteMany({ where: { noticeId: id } });
			if (ownedHashes.length > 0 || ownedReleases.length > 0) {
				const freedHashes = new Set(ownedHashes.map((h) => h.hash));
				const freedReleases = new Set(ownedReleases.map((r) => r.name));
				const others = (
					await tx.takedownNotice.findMany({
						where: { status: 'approved', id: { not: id } },
						orderBy: { reviewedAt: 'asc' },
					})
				).map(toRow);
				for (const other of others) {
					const hashes = other.hashes.filter((h) => freedHashes.delete(h));
					const releases = other.releases.filter((r) => freedReleases.delete(r));
					if (hashes.length > 0) {
						await tx.blockedHash.createMany({
							data: hashes.map((hash) => ({ hash, noticeId: other.id })),
						});
					}
					if (releases.length > 0) {
						await tx.blockedRelease.createMany({
							data: releases.map((name) => ({ name, noticeId: other.id })),
						});
					}
				}
			}
			const updated = await tx.takedownNotice.update({
				where: { id },
				data: { status: 'rejected', reviewNote, reviewedAt: new Date() },
			});
			return toRow(updated);
		});
	}

	public async getBlocked(): Promise<{ hashes: string[]; releases: string[] }> {
		const [hashes, releases] = await Promise.all([
			this.prisma.blockedHash.findMany({ select: { hash: true } }),
			this.prisma.blockedRelease.findMany({ select: { name: true } }),
		]);
		return {
			hashes: hashes.map((h) => h.hash.toLowerCase()),
			releases: releases.map((r) => r.name),
		};
	}
}
