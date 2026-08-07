import { repository as db } from '@/services/repository';
import { resolveAllDebridUser } from '@/utils/allDebridCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, private');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, movieMaxSize, episodeMaxSize, otherStreamsLimit, hideCastOption } = req.body;

	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
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
		// Validates the key and derives the user id in a single AllDebrid call
		const { valid, userId } = await resolveAllDebridUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid AllDebrid API key',
			});
			return;
		}

		// Save the profile with settings
		const profile = await db.saveAllDebridCastProfile(
			userId,
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
		console.error('Error saving AllDebrid cast profile:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
