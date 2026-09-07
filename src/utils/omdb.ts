import { getMetadataCache } from '@/services/metadataCache';

/**
 * The subset of OMDb's response DMM reads. Every field is optional because OMDb
 * omits nothing: absent values come back as the literal string "N/A".
 */
export type OmdbInfo = {
	Title?: string;
	Year?: string;
	Plot?: string;
	Poster?: string;
	imdbRating?: string;
	Response?: string;
	Error?: string;
};

/**
 * A field OMDb actually has a value for, or undefined. "N/A" is OMDb's stand-in
 * for a missing field, so it reads as a real string to a `??` chain and would
 * otherwise be rendered as a title, a plot or a poster URL.
 */
export function omdbField(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed || trimmed === 'N/A') return undefined;
	return trimmed;
}

/**
 * OMDb metadata for an IMDb id, or null when OMDb has no usable answer.
 *
 * OMDb is the last source in every chain it takes part in, so an unset key, a
 * 401 from a wrong one and an unknown id all have to degrade to "no opinion"
 * rather than fail the caller's request. An unknown id answers HTTP 200 with
 * Response:"False", which is a body, not an error — hence the explicit check.
 */
export async function getOmdbMetadata(imdbId: string): Promise<OmdbInfo | null> {
	try {
		const data = await getMetadataCache().getOmdbInfo(imdbId);
		if (!data || data.Response === 'False') return null;
		return data as OmdbInfo;
	} catch (error) {
		console.warn(`[OMDb] lookup failed for ${imdbId}`, error);
		return null;
	}
}

/**
 * OMDb's poster URL, which points at m.media-amazon.com and carries no API key,
 * so it is safe to hand to a browser. img.omdbapi.com is deliberately not used:
 * it needs the key in the query string and would leak it to every visitor.
 */
export function getOmdbPoster(info: OmdbInfo | null): string | null {
	const poster = omdbField(info?.Poster);
	return poster?.startsWith('http') ? poster : null;
}

/**
 * OMDb's IMDb rating on its native 0-10 scale, or null.
 */
export function getOmdbRating(info: OmdbInfo | null): number | null {
	const rating = omdbField(info?.imdbRating);
	if (!rating) return null;
	const parsed = parseFloat(rating);
	return Number.isFinite(parsed) ? parsed : null;
}
