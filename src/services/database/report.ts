import { DatabaseClient } from './client';

export class ReportService extends DatabaseClient {
	/**
	 * Creates or updates a report for incorrect content.
	 * @param hash - The hash of the torrent being reported
	 * @param imdbId - The IMDB ID of the content
	 * @param userId - The user ID (from RealDebrid or AllDebrid)
	 * @param type - The type of report ('porn', 'wrong_imdb', or 'wrong_season')
	 * @returns A promise that resolves when the report is saved
	 */
	public async reportContent(
		hash: string,
		imdbId: string,
		userId: string,
		type: 'porn' | 'wrong_imdb' | 'wrong_season'
	): Promise<void> {
		try {
			await this.prisma.report.upsert({
				where: {
					hash_userId: {
						hash,
						userId,
					},
				},
				update: {
					type,
					createdAt: new Date(),
				},
				create: {
					hash,
					imdbId,
					userId,
					type,
				},
			});
		} catch (error: any) {
			throw new Error(`Failed to save report: ${error.message}`);
		}
	}

	public async getEmptyMedia(quantity = 3): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				OR: [
					{
						key: { startsWith: `tv:tt` },
						value: { equals: [] },
					},
					{
						key: { startsWith: `movie:tt` },
						value: { equals: [] },
					},
				],
			},
			orderBy: { updatedAt: 'asc' },
			take: quantity,
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			return scrapedItems.map((item) => item.key.split(':')[1]);
		}

		return null;
	}

	/**
	 * Gets hashes that should be filtered out based on reports.
	 * A hash is filtered if:
	 * - It has 2 or more reports from different userIds
	 * - It has any report from userId 'A4HGOIVJY65UIOOTMCD77OZCSYA6UFDYGYJI7WVCDF7QIBA7KDGQ' (admin/moderator)
	 * @param imdbId - The IMDB ID to get reported hashes for
	 * @returns Array of hash strings that should be filtered out
	 */
	public async getReportedHashes(imdbId: string): Promise<string[]> {
		try {
			// Get all reports for this imdbId
			const reports = await this.prisma.report.findMany({
				where: { imdbId },
				select: {
					hash: true,
					userId: true,
				},
			});

			// Group reports by hash
			const reportsByHash = new Map<string, Set<string>>();
			const adminReportedHashes = new Set<string>();

			for (const report of reports) {
				// Check if this is an admin/moderator report
				if (report.userId === 'A4HGOIVJY65UIOOTMCD77OZCSYA6UFDYGYJI7WVCDF7QIBA7KDGQ') {
					adminReportedHashes.add(report.hash);
				}

				// Track unique userIds per hash
				if (!reportsByHash.has(report.hash)) {
					reportsByHash.set(report.hash, new Set());
				}
				reportsByHash.get(report.hash)!.add(report.userId);
			}

			// Filter hashes based on criteria
			const filteredHashes: string[] = [];

			// Add all admin-reported hashes
			for (const hash of adminReportedHashes) {
				filteredHashes.push(hash);
			}

			// Add hashes with 2+ reports from different users
			for (const [hash, userIds] of reportsByHash) {
				if (userIds.size >= 2 && !adminReportedHashes.has(hash)) {
					filteredHashes.push(hash);
				}
			}

			return filteredHashes;
		} catch (error: any) {
			throw new Error(`Failed to get reported hashes: ${error.message}`);
		}
	}
}
