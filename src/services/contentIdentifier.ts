// content-identifier names the IMDb movie a release filename is (its own repository,
// running on dmm-01 over Tailscale). Configure CONTENT_IDENTIFIER_URL and
// CONTENT_IDENTIFIER_TOKEN; unset, identification is simply unavailable.

export interface IdentifierMatch {
	imdbId: string;
	title: string;
	year: number | null;
	score: number;
}

export interface IdentifierResult {
	/** The first match is right about 98% of the time; anything else needs review. */
	confident: boolean;
	matches: IdentifierMatch[];
}

/** The service's own batch ceiling. */
const SERVICE_BATCH = 1000;
/** A 1,000-name batch takes about 8 s on dmm-01. */
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
				body: JSON.stringify({ filenames: filenames.slice(at, at + SERVICE_BATCH) }),
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
