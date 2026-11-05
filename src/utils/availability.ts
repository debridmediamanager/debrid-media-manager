import { isValidHash } from './extractHashes';
import { generateTokenAndHash } from './token';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_REFUSALS = 5;

/**
 * POSTs to an availability route, waiting out its rate limit: a refused batch is
 * asked again after Retry-After instead of leaving its hashes looking uncached.
 */
export async function postAvailability(
	url: string,
	init: RequestInit,
	wait: (ms: number) => Promise<unknown> = sleep
): Promise<Response> {
	for (let refusals = 0; ; refusals++) {
		const response = await fetch(url, init);
		if (response.status !== 429 || refusals === MAX_REFUSALS) return response;
		const seconds = Number(response.headers.get('retry-after')) || 10;
		await wait(Math.min(seconds, 60) * 1000);
	}
}

/**
 * Record a torrent of the user's own as cached on Real-Debrid. Only the token and the
 * torrent's id travel: DMM reads the torrent from RD itself and records what RD says.
 */
export async function submitAvailability(
	dmmProblemKey: string,
	solution: string,
	rdKey: string,
	torrentId: string,
	imdbId: string
) {
	try {
		const response = await fetch('/api/availability', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ rdKey, torrentId, imdbId, dmmProblemKey, solution }),
		});
		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw new Error(error.error || 'Failed to submit availability');
		}
		return await response.json();
	} catch (error) {
		console.error('Error submitting availability:', error);
		throw error;
	}
}

export async function checkAvailability(
	dmmProblemKey: string,
	solution: string,
	imdbId: string,
	hashes: string[]
) {
	try {
		// Filter out invalid hashes proactively to avoid API 400s
		const validHashes = (hashes || []).filter(isValidHash);
		if (validHashes.length === 0) {
			return { available: [] } as any;
		}
		const response = await postAvailability('/api/availability/check', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				imdbId,
				hashes: validHashes,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			let error: any = {};
			try {
				error = await response.json();
			} catch {}
			const detail = error.hash ? ` (invalid: ${error.hash})` : '';
			throw new Error(
				error.error || error.errorMessage || `Failed to check availability${detail}`
			);
		}

		return await response.json();
	} catch (error) {
		console.error('Error checking availability:', error);
		throw error;
	}
}

export async function checkAvailabilityByHashes(
	dmmProblemKey: string,
	solution: string,
	hashes: string[]
) {
	try {
		// Filter out invalid hashes proactively to avoid API 400s
		const validHashes = (hashes || []).filter(isValidHash);
		if (validHashes.length === 0) {
			return { available: [] } as any;
		}
		const response = await postAvailability('/api/availability/check2', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				hashes: validHashes,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			let error: any = {};
			try {
				error = await response.json();
			} catch {}
			const detail = error.hash ? ` (invalid: ${error.hash})` : '';
			throw new Error(
				error.error ||
					error.errorMessage ||
					`Failed to check availability by hashes${detail}`
			);
		}

		return await response.json();
	} catch (error) {
		console.error('Error checking availability by hashes:', error);
		throw error;
	}
}

/**
 * The names DMM's Real-Debrid availability rows record for these hashes, by
 * lower-case hash: RD's own name for the torrent, then the selected file's. For
 * an add that has nothing but the hash (the browser extension's
 * `?addMagnet=`, a pasted hash list), so a 451 on a name RD blocks reads as
 * that and not as the account's pause. A lookup that fails answers nothing,
 * which leaves the add as it was.
 */
export async function fetchRdNamesOnRecord(hashes: string[]): Promise<Map<string, string[]>> {
	const names = new Map<string, string[]>();
	try {
		const wanted = [...new Set(hashes.filter(isValidHash).map((h) => h.toLowerCase()))];
		if (wanted.length === 0) return names;
		const [key, solution] = await generateTokenAndHash();
		for (let i = 0; i < wanted.length; i += 100) {
			const { available } = await checkAvailabilityByHashes(
				key,
				solution,
				wanted.slice(i, i + 100)
			);
			for (const row of available ?? []) {
				names.set(String(row.hash).toLowerCase(), [row.originalFilename, row.filename]);
			}
		}
	} catch {
		// no names: the add goes ahead as if this had never been asked
	}
	return names;
}

/**
 * Ask DMM to forget a Real-Debrid row. With `proof` (the user's add of it), DMM reads the
 * add from RD and removes the row only if RD is downloading it; without, only if the row's
 * own name is one RD refuses. A refusal is an answer, not an error.
 */
export async function removeAvailability(
	dmmProblemKey: string,
	solution: string,
	hash: string,
	reason: string,
	proof?: { rdKey: string; torrentId: string }
) {
	try {
		const response = await fetch('/api/availability/remove', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hash, reason, ...proof, dmmProblemKey, solution }),
		});
		if (response.status === 409) return { success: false };
		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw new Error(error.error || 'Failed to remove availability');
		}
		return await response.json();
	} catch (error) {
		console.error('Error removing availability:', error);
		throw error;
	}
}

// ====================================================================
// AllDebrid Availability Functions
// ====================================================================

export async function submitAvailabilityAd(
	dmmProblemKey: string,
	solution: string,
	data: {
		hash: string;
		imdbId: string;
		filename: string;
		size: number;
		status: string;
		statusCode: number;
		completionDate: number;
		files: Array<{ n: string; s: number; l: string }>;
	}
) {
	try {
		const response = await fetch('/api/availability/ad', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				...data,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to submit AllDebrid availability');
		}

		return await response.json();
	} catch (error) {
		console.error('Error submitting AllDebrid availability:', error);
		throw error;
	}
}

/**
 * Tell DMM AllDebrid did not have a release ready when this user added it: the row stops
 * reading as cached (status and files cleared), as an add that comes back downloading
 * already does. AllDebrid cannot be asked from DMM's servers, so this is the page's word,
 * bounded by the route's rate limit.
 */
export async function reportAdNotCached(dmmProblemKey: string, solution: string, hash: string) {
	const response = await fetch('/api/availability/ad', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			hash: hash.toLowerCase(),
			status: 'Not instant',
			statusCode: 0,
			files: [],
			dmmProblemKey,
			solution,
		}),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.error || 'Failed to report AllDebrid availability');
	}
	return response.json();
}

export async function checkAvailabilityAd(
	dmmProblemKey: string,
	solution: string,
	imdbId: string,
	hashes: string[]
) {
	try {
		// Filter out invalid hashes proactively to avoid API 400s
		const validHashes = (hashes || []).filter(isValidHash);
		if (validHashes.length === 0) {
			return { available: [] } as any;
		}

		const response = await postAvailability('/api/availability/ad/check', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				imdbId,
				hashes: validHashes,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			let error: any = {};
			try {
				error = await response.json();
			} catch {}
			const detail = error.hash ? ` (invalid: ${error.hash})` : '';
			throw new Error(
				error.error ||
					error.errorMessage ||
					`Failed to check AllDebrid availability${detail}`
			);
		}

		return await response.json();
	} catch (error) {
		console.error('Error checking AllDebrid availability:', error);
		throw error;
	}
}

export async function checkAvailabilityAdByHashes(
	dmmProblemKey: string,
	solution: string,
	hashes: string[]
) {
	try {
		// Filter out invalid hashes proactively to avoid API 400s
		const validHashes = (hashes || []).filter(isValidHash);
		if (validHashes.length === 0) {
			return { available: [] } as any;
		}

		const response = await postAvailability('/api/availability/ad/check2', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				hashes: validHashes,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			let error: any = {};
			try {
				error = await response.json();
			} catch {}
			const detail = error.hash ? ` (invalid: ${error.hash})` : '';
			throw new Error(
				error.error ||
					error.errorMessage ||
					`Failed to check AllDebrid availability by hashes${detail}`
			);
		}

		return await response.json();
	} catch (error) {
		console.error('Error checking AllDebrid availability by hashes:', error);
		throw error;
	}
}

// Measured against the production database on 2026-09-30: 2,000 hashes answer
// in ~180 ms. 500 keeps a 28k-item hashlist to 56 requests while giving an
// unthrottled caller five times, not twenty, the reach of check2's 100.
export const MAX_PLAYABLE_HASHES = 500;

/**
 * The hashes, lower-cased, that `service` holds cached with a playable video.
 * Backed by DMM's own database, so it is not subject to Real-Debrid's rate
 * limit; callers batch by `MAX_PLAYABLE_HASHES`.
 */
export async function checkPlayableCachedHashes(
	dmmProblemKey: string,
	solution: string,
	service: 'rd' | 'ad',
	hashes: string[]
): Promise<string[]> {
	const validHashes = hashes.filter(isValidHash);
	if (validHashes.length === 0) return [];
	const response = await postAvailability('/api/availability/playable', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ dmmProblemKey, solution, service, hashes: validHashes }),
	});
	if (!response.ok) {
		let error: any = {};
		try {
			error = await response.json();
		} catch {}
		throw new Error(error.error || error.errorMessage || 'Failed to check availability');
	}
	const { cached } = (await response.json()) as { cached: string[] };
	return cached;
}

// ====================================================================
// Debrid-Link Availability Functions
// ====================================================================

/** Ask DMM to record a release on Debrid-Link; DMM asks Debrid-Link itself. */
export async function submitAvailabilityDl(
	dmmProblemKey: string,
	solution: string,
	data: { hash: string; imdbId: string }
) {
	const response = await fetch('/api/availability/dl', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			hash: data.hash.toLowerCase(),
			imdbId: data.imdbId,
			dmmProblemKey,
			solution,
		}),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.error || 'Failed to submit Debrid-Link availability');
	}
	return response.json();
}

/** The hashes DMM has seen whole on Debrid-Link, under `imdbId` when one is given. */
export async function checkAvailabilityDl(
	dmmProblemKey: string,
	solution: string,
	hashes: string[],
	imdbId?: string
): Promise<{
	available: { hash: string; files: { file_id: number; path: string; bytes: number }[] }[];
}> {
	const validHashes = (hashes || []).filter(isValidHash);
	if (validHashes.length === 0) return { available: [] };
	const response = await postAvailability('/api/availability/dl/check', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ imdbId, hashes: validHashes, dmmProblemKey, solution }),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(
			error.error || error.errorMessage || 'Failed to check Debrid-Link availability'
		);
	}
	return response.json();
}

/** Ask DMM to forget a Debrid-Link release; DMM asks Debrid-Link before it does. */
export async function removeAvailabilityDl(
	dmmProblemKey: string,
	solution: string,
	hash: string,
	reason: string
) {
	const response = await fetch('/api/availability/dl/remove', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ hash, reason, dmmProblemKey, solution }),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.error || 'Failed to remove Debrid-Link availability');
	}
	return response.json();
}

/**
 * Offer a Debrid-Link hit to DMM's table under `imdbId`. DMM asks Debrid-Link whether it
 * holds the release whole and records what Debrid-Link lists, so a page passes no files.
 * True when it was sent.
 */
export async function recordDlAvailability(imdbId: string, hash: string): Promise<boolean> {
	if (!/^tt\d+$/.test(imdbId) || !isValidHash(hash)) return false;
	const [key, solution] = await generateTokenAndHash();
	await submitAvailabilityDl(key, solution, { hash, imdbId });
	return true;
}
