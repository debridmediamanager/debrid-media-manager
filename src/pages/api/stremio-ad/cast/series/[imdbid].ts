import { getVerifiedAllDebridCastFiles } from '@/services/allDebridCastSelection';
import { repository as db } from '@/services/repository';
import { sendAllDebridApiError } from '@/utils/allDebridApiError';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { isAllDebridLockedLink } from '@/utils/allDebridLockedLink';
import { NextApiRequest, NextApiResponse } from 'next';

interface SavedFile {
	fileIndex: number;
	link: string;
	filename: string;
	fileSize: number;
	season?: number;
	episode?: number;
}

// The browser uploads; provider reads verify each saved file before sharing it.
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
		const verifiedFiles = await getVerifiedAllDebridCastFiles(apiKey, magnetId, hash);
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
			const file =
				Number.isSafeInteger(fileIndex) && fileIndex >= 0
					? verifiedFiles[fileIndex]
					: undefined;
			if (!file || !isAllDebridLockedLink(file.link) || file.link !== link) {
				errorEpisodes.push(filename);
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
					hash.toLowerCase(),
					file.path.split('/').pop()!,
					file.link,
					Math.round(file.size / 1024 / 1024),
					magnetId,
					fileIndex
				);
			} catch {
				console.error('Failed to save AllDebrid episode cast selection');
				errorEpisodes.push(filename);
			}
		}

		res.status(200).json({
			status: errorEpisodes.length === 0 ? 'success' : 'partial',
			errorEpisodes,
		});
	} catch (e) {
		console.error('Failed to verify or save AllDebrid series cast selection');
		sendAllDebridApiError(e, res);
	}
}
