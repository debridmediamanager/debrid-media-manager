import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const getAnimeInfo = (id: string) => `https://anime-kitsu.strem.fun/meta/series/${id}.json`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { animeid } = req.query;

	if (!animeid || typeof animeid !== 'string') {
		return res.status(400).json({ error: 'Anime ID is required' });
	}

	try {
		const animeurl = getAnimeInfo(animeid.replace('-', '%3A'));
		const response = await axios.get(animeurl, {
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

		const imdbRating = response.data.meta.imdbRating ?? '0';

		return res.status(200).json({
			title: response.data.meta.name,
			description: response.data.meta.description ?? '',
			poster: response.data.meta.poster ?? '',
			backdrop: response.data.meta.background ?? '',
			imdbid: response.data.meta.imdb_id ?? '',
			imdbRating: parseFloat(imdbRating),
		});
	} catch (error) {
		return res.status(200).json({
			title: 'Unknown',
			description: 'Unknown',
			poster: 'https://picsum.photos/200/300',
			backdrop: '',
			imdbid: '',
			imdbRating: 0,
		});
	}
}
