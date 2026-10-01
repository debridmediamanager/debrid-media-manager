import { TorrentInfoResponse } from '@/services/types';
import { isValidHash } from './extractHashes';

export async function submitAvailability(
	dmmProblemKey: string,
	solution: string,
	torrentInfo: TorrentInfoResponse,
	imdbId: string
) {
	// filter out any torrents that are not downloaded for now
	if (torrentInfo.status !== 'downloaded') {
		return;
	}

	try {
		const response = await fetch('/api/availability', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				...torrentInfo,
				imdbId,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
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
		const response = await fetch('/api/availability/check', {
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
		const response = await fetch('/api/availability/check2', {
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

export async function removeAvailability(
	dmmProblemKey: string,
	solution: string,
	hash: string,
	reason: string
) {
	try {
		const response = await fetch('/api/availability/remove', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				hash,
				reason,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
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
	// Only submit if statusCode is 4 (Ready/Cached)
	if (data.statusCode !== 4 || data.status !== 'Ready') {
		return;
	}

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

		const response = await fetch('/api/availability/ad/check', {
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

		const response = await fetch('/api/availability/ad/check2', {
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
	const response = await fetch('/api/availability/playable', {
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
