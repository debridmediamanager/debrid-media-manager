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
}
