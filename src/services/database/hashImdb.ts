import { DatabaseClient } from './client';

export interface HashImdbPair {
	hash: string;
	imdbId: string;
}

export class HashImdbService extends DatabaseClient {
	public async upsertBatch(pairs: HashImdbPair[]) {
		const results: { id: string; created: boolean }[] = [];

		for (const { hash, imdbId } of pairs) {
			// Check if this exact hash+imdbId combo already exists
			const existing = await this.prisma.hashImdb.findFirst({
				where: { hash, imdbId },
			});

			if (existing) {
				// Same imdbId — just bump updatedAt
				await this.prisma.hashImdb.update({
					where: { id: existing.id },
					data: { updatedAt: new Date() },
				});
				results.push({ id: existing.id, created: false });
				continue;
			}

			// Different imdbId or first entry — find next available id
			const existingForHash = await this.prisma.hashImdb.findMany({
				where: { hash },
				select: { id: true },
				orderBy: { id: 'asc' },
			});

			let id: string;
			if (existingForHash.length === 0) {
				id = hash;
			} else {
				// Find the next index: hash-1, hash-2, etc.
				let maxIdx = 0;
				for (const row of existingForHash) {
					if (row.id === hash) continue;
					const suffix = row.id.slice(hash.length + 1);
					const idx = parseInt(suffix, 10);
					if (!isNaN(idx) && idx > maxIdx) {
						maxIdx = idx;
					}
				}
				id = `${hash}-${maxIdx + 1}`;
			}

			await this.prisma.hashImdb.create({
				data: { id, hash, imdbId },
			});
			results.push({ id, created: true });
		}

		return results;
	}

	public async getByHash(hash: string) {
		return this.prisma.hashImdb.findMany({
			where: { hash },
			orderBy: { createdAt: 'asc' },
		});
	}

	public async getByHashes(hashes: string[]) {
		if (hashes.length === 0) return [];
		return this.prisma.hashImdb.findMany({
			where: { hash: { in: hashes } },
			orderBy: { createdAt: 'asc' },
		});
	}
}
