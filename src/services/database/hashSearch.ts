import { rdLinkCutoff } from '@/utils/rdLinkRot';
import { DatabaseClient } from './client';

export interface SizeFilters {
	min?: number; // minimum size in GB (inclusive >=)
	max?: number; // maximum size in GB (inclusive <=)
}

export interface SubstringFilters {
	blacklist?: string[]; // exclude if filename contains ANY of these
	whitelist?: string[]; // include ONLY if filename contains ANY of these
}

export interface HashSearchParams {
	imdbId: string;
	sizeFilters?: SizeFilters;
	substringFilters?: SubstringFilters;
	limit?: number;
}

export interface HashResult {
	hash: string;
	source: 'available' | 'cast' | 'scraped';
	filename: string;
	size: number; // in bytes
	sizeGB: number;
	imdbId: string;
}

function getSizeInBytes(sizeGB: number): bigint {
	return BigInt(Math.floor(sizeGB * 1024 * 1024 * 1024));
}

function getSizeInMB(sizeGB: number): bigint {
	return BigInt(Math.floor(sizeGB * 1024));
}

// For Available table (bytes column stores actual bytes)
function buildSizeCondition(filters?: SizeFilters): Record<string, bigint> {
	if (!filters) return {};

	const condition: Record<string, bigint> = {};

	if (filters.min !== undefined) {
		condition.gte = getSizeInBytes(filters.min);
	}
	if (filters.max !== undefined) {
		condition.lte = getSizeInBytes(filters.max);
	}

	return condition;
}

// For Cast table (size column stores MEGABYTES, not bytes)
// See SIZE_UNITS_ANALYSIS.md for details
function buildSizeConditionMB(filters?: SizeFilters): Record<string, bigint> {
	if (!filters) return {};

	const condition: Record<string, bigint> = {};

	if (filters.min !== undefined) {
		condition.gte = getSizeInMB(filters.min);
	}
	if (filters.max !== undefined) {
		condition.lte = getSizeInMB(filters.max);
	}

	return condition;
}

function matchesSubstringFilters(filename: string, filters?: SubstringFilters): boolean {
	if (!filters) return true;

	const lowerFilename = filename.toLowerCase();

	// Check blacklist first - if ANY blacklisted substring matches, exclude it
	if (filters.blacklist && filters.blacklist.length > 0) {
		const lowerBlacklist = filters.blacklist.map((s) => s.toLowerCase());
		if (lowerBlacklist.some((sub) => lowerFilename.includes(sub))) {
			return false;
		}
	}

	// Check whitelist - if whitelist exists, filename MUST contain at least one whitelisted substring
	if (filters.whitelist && filters.whitelist.length > 0) {
		const lowerWhitelist = filters.whitelist.map((s) => s.toLowerCase());
		if (!lowerWhitelist.some((sub) => lowerFilename.includes(sub))) {
			return false;
		}
	}

	return true;
}

function matchesSizeFilters(sizeInBytes: number, filters?: SizeFilters): boolean {
	if (!filters) return true;

	const sizeGB = sizeInBytes / (1024 * 1024 * 1024);

	if (filters.min !== undefined && sizeGB < filters.min) {
		return false;
	}

	if (filters.max !== undefined && sizeGB > filters.max) {
		return false;
	}

	return true;
}

export class HashSearchService extends DatabaseClient {
	public async getHashesByImdbId({
		imdbId,
		sizeFilters,
		substringFilters,
		limit = 5,
	}: HashSearchParams): Promise<HashResult[]> {
		const results: HashResult[] = [];

		// Phase 1: Query Available
		const availableResults = await this.queryAvailable(imdbId, sizeFilters, substringFilters);
		results.push(...availableResults);

		if (results.length >= limit) {
			return results.slice(0, limit);
		}

		// Phase 2: Query Cast
		const castResults = await this.queryCast(imdbId, sizeFilters, substringFilters);
		results.push(...castResults);

		if (results.length >= limit) {
			return results.slice(0, limit);
		}

		// Phase 3: Query Scraped
		const scrapedResults = await this.queryScraped(imdbId, sizeFilters, substringFilters);
		results.push(...scrapedResults);

		return results.slice(0, limit);
	}

	private async queryAvailable(
		imdbId: string,
		sizeFilters?: SizeFilters,
		substringFilters?: SubstringFilters
	): Promise<HashResult[]> {
		const sizeCondition = buildSizeCondition(sizeFilters);

		const results = await this.prisma.available.findMany({
			where: {
				imdbId,
				status: 'downloaded',
				bytes: sizeCondition,
			},
			select: {
				hash: true,
				filename: true,
				originalFilename: true,
				bytes: true,
				imdbId: true,
			},
			orderBy: { bytes: 'desc' },
			take: 100, // Over-fetch for substring filtering
		});

		// Apply substring filter in-memory
		return results
			.filter(
				(r) =>
					matchesSubstringFilters(r.filename, substringFilters) ||
					matchesSubstringFilters(r.originalFilename, substringFilters)
			)
			.map((r) => ({
				hash: r.hash,
				source: 'available' as const,
				filename: r.filename,
				size: Number(r.bytes),
				sizeGB: Number(r.bytes) / (1024 * 1024 * 1024),
				imdbId: r.imdbId,
			}));
	}

	private async queryCast(
		imdbId: string,
		sizeFilters?: SizeFilters,
		substringFilters?: SubstringFilters
	): Promise<HashResult[]> {
		// IMPORTANT: Cast.size stores MEGABYTES, not bytes!
		// See SIZE_UNITS_ANALYSIS.md for details on why this field stores MB
		const sizeCondition = buildSizeConditionMB(sizeFilters);

		const results = await this.prisma.cast.findMany({
			where: {
				imdbId,
				link: { not: null },
				size: sizeCondition, // Filter using MB values
				updatedAt: { gt: rdLinkCutoff() },
			},
			select: {
				hash: true,
				url: true,
				size: true,
				imdbId: true,
			},
			orderBy: { size: 'desc' },
			distinct: ['hash'], // Deduplicate by hash
			take: 100,
		});

		return results
			.map((r) => {
				const filename = r.url.split('/').pop() || 'Unknown';
				return { ...r, filename, sizeNum: Number(r.size) };
			})
			.filter((r) => matchesSubstringFilters(r.filename, substringFilters))
			.map((r) => ({
				hash: r.hash,
				source: 'cast' as const,
				filename: r.filename,
				// Cast.size is in MB, convert to bytes for consistent API output
				size: r.sizeNum * 1024 * 1024,
				// Cast.size is in MB, convert to GB
				sizeGB: r.sizeNum / 1024,
				imdbId: r.imdbId,
			}));
	}

	private async queryScraped(
		imdbId: string,
		sizeFilters?: SizeFilters,
		substringFilters?: SubstringFilters
	): Promise<HashResult[]> {
		const movieKey = `movie:${imdbId}`;
		const tvKey = `tv:${imdbId}`;

		// Try both movie and TV keys
		const [movieData, tvData] = await Promise.all([
			this.prisma.scraped.findUnique({ where: { key: movieKey } }),
			this.prisma.scraped.findUnique({ where: { key: tvKey } }),
		]);

		const data = movieData || tvData;
		if (!data) return [];

		const scrapedResults = data.value as Array<{
			hash: string;
			title: string;
			fileSize: number; // in MB
		}>;

		return scrapedResults
			.filter((r) => {
				const sizeInBytes = r.fileSize * 1024 * 1024;

				// Size filter
				if (!matchesSizeFilters(sizeInBytes, sizeFilters)) {
					return false;
				}

				// Substring filter
				return matchesSubstringFilters(r.title, substringFilters);
			})
			.map((r) => ({
				hash: r.hash,
				source: 'scraped' as const,
				filename: r.title,
				size: r.fileSize * 1024 * 1024, // MB to bytes
				sizeGB: r.fileSize / 1024,
				imdbId,
			}));
	}
}
