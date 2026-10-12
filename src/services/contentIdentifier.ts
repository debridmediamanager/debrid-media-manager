// content-identifier names the IMDb movie or show a release filename is (its own repository,
// running on dmm-01 over Tailscale). Configure CONTENT_IDENTIFIER_URL and
// CONTENT_IDENTIFIER_TOKEN; unset, identification is simply unavailable.

export interface IdentifierMatch {
	imdbId: string;
	title: string;
	year: number | null;
	score: number;
}

/** Whether a name is a movie or a show; the service decides. */
export type IdentifierKind = 'movie' | 'tv';

export interface IdentifierResult {
	kind?: IdentifierKind;
	/** The service's probability that the first match is right. */
	probability?: number;
	/** The title the service read from the filename. */
	parsedTitle?: string;
	/** The year the filename names, if any. */
	parsedYear?: number | null;
	/** The first match clears the service's calibrated precision bar. */
	confident: boolean;
	matches: IdentifierMatch[];
}

/** The service's own batch ceiling. */
const SERVICE_BATCH = 1000;
/** A 1,000-name batch takes about 8 s on dmm-01 per kind, and both kinds are asked. */
const TIMEOUT_MS = 30_000;

/** One result per filename, in order, or null when the service cannot be reached. */
export async function identifyFilenames(filenames: string[]): Promise<IdentifierResult[] | null> {
	const base = process.env.CONTENT_IDENTIFIER_URL?.replace(/\/+$/, '');
	if (!base) return null;
	const results: IdentifierResult[] = [];
	for (let at = 0; at < filenames.length; at += SERVICE_BATCH) {
		try {
			const response = await fetch(`${base}/identify/batch`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-identifier-token': process.env.CONTENT_IDENTIFIER_TOKEN ?? '',
				},
				body: JSON.stringify({
					filenames: filenames.slice(at, at + SERVICE_BATCH),
					kind: 'auto',
				}),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!response.ok) {
				console.error(`content-identifier answered ${response.status}`);
				return null;
			}
			results.push(...((await response.json()) as { results: IdentifierResult[] }).results);
		} catch (error) {
			console.error('content-identifier unreachable:', (error as Error).message);
			return null;
		}
	}
	return results;
}
