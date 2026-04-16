import { repository as db } from '@/services/repository';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

interface SavedFile {
	fileIndex: number;
	link: string;
	filename: string;
	fileSize: number;
	season?: number;
	episode?: number;
}

// SERIES cast (save): client does the AllDebrid work (see cast/movie handler for
// context), and POSTs an array of resolved files here to persist them.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		res.status(405).json({ status: 'error', errorMessage: 'Method not allowed' });
		return;
	}

	const { imdbid } = req.query;
	const { apiKey, hash, magnetId, files } = req.body ?? {};

	if (
		typeof imdbid !== 'string' ||
		typeof apiKey !== 'string' ||
		typeof hash !== 'string' ||
		typeof magnetId !== 'number' ||
		!Array.isArray(files) ||
		files.length === 0
	) {
		res.status(400).json({ status: 'error', errorMessage: 'Missing or invalid fields' });
		return;
	}

	try {
		const userid = await generateAllDebridUserId(apiKey);
		const errorEpisodes: string[] = [];

		for (const raw of files as SavedFile[]) {
			const { fileIndex, link, filename, fileSize, season, episode } =
				raw || ({} as SavedFile);
			if (
				typeof fileIndex !== 'number' ||
				typeof link !== 'string' ||
				typeof filename !== 'string' ||
				typeof fileSize !== 'number'
			) {
				errorEpisodes.push(`Invalid file entry: ${filename ?? '(unknown)'}`);
				continue;
			}

			let episodeImdbId = imdbid;
			if (
				typeof season === 'number' &&
				season >= 0 &&
				typeof episode === 'number' &&
				episode >= 0
			) {
				episodeImdbId = `${imdbid}:${season}:${episode}`;
			}

			try {
				await db.saveAllDebridCast(
					episodeImdbId,
					userid,
					hash,
					filename,
					link,
					fileSize,
					magnetId,
					fileIndex
				);
			} catch (e) {
				console.error(`Error saving cast for ${filename}:`, e);
				errorEpisodes.push(filename);
			}
		}

		res.status(200).json({
			status: errorEpisodes.length === 0 ? 'success' : 'partial',
			errorEpisodes,
		});
	} catch (e) {
		console.error(e);
		const message = e instanceof Error ? e.message : String(e);
		res.status(500).json({ status: 'error', errorMessage: message });
	}
}
