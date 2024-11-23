import { TorrentInfoResponse } from '../services/types';

export async function submitAvailability(
	dmmProblemKey: string,
	solution: string,
	torrentInfo: TorrentInfoResponse,
	imdbId: string
) {
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
		const response = await fetch('/api/availability/check', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				imdbId,
				hashes,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to check availability');
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
		const response = await fetch('/api/availability/check2', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				hashes,
				dmmProblemKey,
				solution,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to check availability by hashes');
		}

		return await response.json();
	} catch (error) {
		console.error('Error checking availability by hashes:', error);
		throw error;
	}
}
