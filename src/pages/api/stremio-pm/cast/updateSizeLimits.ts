import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

// Settings-only update keyed by the cast user id the client already holds, so
// no Premiumize call is needed and the API key never leaves the browser.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { userId, movieMaxSize, episodeMaxSize, otherStreamsLimit, hideCastOption } =
		req.body ?? {};

	if (!userId || typeof userId !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "userId" in request body',
		});
		return;
	}

	if (otherStreamsLimit !== undefined) {
		const limit = Number(otherStreamsLimit);
		if (!Number.isInteger(limit) || limit < 0 || limit > 5) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'otherStreamsLimit must be an integer between 0 and 5',
			});
			return;
		}
	}

	try {
		const updated = await db.updatePremiumizeCastSettings(
			userId,
			typeof movieMaxSize === 'number' ? movieMaxSize : undefined,
			typeof episodeMaxSize === 'number' ? episodeMaxSize : undefined,
			typeof otherStreamsLimit === 'number' ? otherStreamsLimit : undefined,
			hideCastOption !== undefined ? Boolean(hideCastOption) : undefined
		);

		// 404 lets the client fall back to a full save with the key in hand
		if (!updated) {
			res.status(404).json({ status: 'error', errorMessage: 'No Premiumize cast profile' });
			return;
		}

		res.status(200).json({ status: 'success' });
	} catch (error) {
		console.error('Error updating Premiumize cast settings:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
