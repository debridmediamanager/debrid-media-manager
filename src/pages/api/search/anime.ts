import { Repository } from '@/services/repository';
import { NextApiHandler } from 'next';

const db = new Repository();
const inMemoryCache: Record<string, number[]> = {};

const handler: NextApiHandler = async (req, res) => {
	const { keyword } = req.query;

	if (!keyword || !(typeof keyword === 'string')) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "keyword" query parameter',
		});
		return;
	}

	try {
		// fetch https://api.jikan.moe/v4/anime?q=one%20piece&sfw
		// const response = await fetch(`https://api.jikan.moe/v4/anime?q=${keyword.toLocaleLowerCase()}&sfw`).then(res => res.json());

		// fetch https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-list/search=one%20piece.json
		let kitsuIds = [];
		if (inMemoryCache[keyword]) {
			kitsuIds = inMemoryCache[keyword];
		} else {
			kitsuIds = await fetch(
				`https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-list/search=${keyword.toLocaleLowerCase()}.json`
			)
				.then((res) => res.json())
				.then((res) =>
					res.metas.map((anime: any) => parseInt(anime.id.replace('kitsu:', ''), 10))
				);
			inMemoryCache[keyword] = kitsuIds;
		}

		const results: AnimeSearchResult[] = await db.getAnimeByKitsuIds(kitsuIds);
		res.status(200).json({ results });
	} catch (error) {
		console.error('An error occurred while fetching the data:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'An error occurred while fetching the data',
		});
	}
};

export default handler;
