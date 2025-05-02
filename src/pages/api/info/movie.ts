import { MRating } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const getCinemetaInfo = (imdbId: string) =>
	`https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		const mdblistClient = getMdblistClient();
		const mdbPromise = mdblistClient.getInfoByImdbId(imdbid);
		const cinePromise = axios.get(getCinemetaInfo(imdbid), {
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.5',
				'accept-encoding': 'gzip, deflate, br',
				connection: 'keep-alive',
				'sec-fetch-dest': 'document',
				'sec-fetch-mode': 'navigate',
				'sec-fetch-site': 'same-origin',
				'sec-fetch-user': '?1',
				'upgrade-insecure-requests': '1',
				'user-agent': new UserAgent().toString(),
			},
		});

		const [mdbResponse, cinemetaResponse] = await Promise.all([mdbPromise, cinePromise]);

		let imdb_score =
			(mdbResponse.ratings?.reduce((acc: number | undefined, rating: MRating) => {
				if (rating.source === 'imdb') {
					return rating.score as number;
				}
				return acc;
			}, undefined) ?? cinemetaResponse.data.meta?.imdbRating)
				? parseFloat(cinemetaResponse.data.meta?.imdbRating) * 10
				: null;

		const title = mdbResponse.title ?? cinemetaResponse.data.meta?.name ?? 'Unknown';

		return res.status(200).json({
			title,
			description:
				mdbResponse.description ?? cinemetaResponse.data.meta?.description ?? 'n/a',
			poster: mdbResponse.poster ?? cinemetaResponse.data.meta?.poster ?? '',
			backdrop:
				mdbResponse.backdrop ??
				cinemetaResponse.data.meta?.background ??
				'https://source.unsplash.com/random/1800x300?' + title,
			year: mdbResponse.year ?? cinemetaResponse.data.meta?.releaseInfo ?? '????',
			imdb_score: imdb_score ?? 0,
		});
	} catch (error) {
		console.error('Error fetching movie info:', error);
		return res.status(200).json({
			title: 'Unknown',
			description: 'n/a',
			poster: '',
			backdrop: 'https://source.unsplash.com/random/1800x300?movie',
			year: '????',
			imdb_score: 0,
		});
	}
}
