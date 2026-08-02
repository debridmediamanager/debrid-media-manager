import { repository as db } from '@/services/repository';
import { generateTorrinUserId, validateTorrinApiKey } from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { baseUrl, apiKey, movieMaxSize, episodeMaxSize, otherStreamsLimit, hideCastOption } =
		req.body;

	if (!apiKey || typeof apiKey !== 'string' || !baseUrl || typeof baseUrl !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "baseUrl"/"apiKey" in request body',
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
		const validation = await validateTorrinApiKey(baseUrl, apiKey);
		if (!validation.valid) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid Torrin credentials',
			});
			return;
		}

		const userId = await generateTorrinUserId(baseUrl, apiKey);

		const profile = await db.saveTorrinCastProfile(
			userId,
			baseUrl,
			apiKey,
			typeof movieMaxSize === 'number' ? movieMaxSize : undefined,
			typeof episodeMaxSize === 'number' ? episodeMaxSize : undefined,
			typeof otherStreamsLimit === 'number' ? otherStreamsLimit : undefined,
			hideCastOption !== undefined ? Boolean(hideCastOption) : undefined
		);

		res.status(200).json({
			status: 'success',
			profile: {
				userId: profile.userId,
				movieMaxSize: profile.movieMaxSize,
				episodeMaxSize: profile.episodeMaxSize,
				otherStreamsLimit: profile.otherStreamsLimit,
				hideCastOption: profile.hideCastOption,
			},
		});
	} catch (error) {
		console.error('Error updating Torrin cast size limits:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to update size limits',
		});
	}
}
