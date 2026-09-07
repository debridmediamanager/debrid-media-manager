import { fetchKitsuAnime } from '@/services/anime/kitsu';
import { repository as db } from '@/services/repository';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const getAnimeInfo = (id: string) => `https://anime-kitsu.strem.fun/meta/series/${id}.json`;

interface AnimeInfoResponse {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	imdbid: string;
	imdbRating: number;
}

const UNKNOWN: AnimeInfoResponse = {
	title: 'Unknown',
	description: 'Unknown',
	poster: 'https://picsum.photos/200/300',
	backdrop: '',
	imdbid: '',
	imdbRating: 0,
};

/** `kitsu-1` and `kitsu:1` both address Kitsu anime 1. */
function parseKitsuId(animeid: string): number | null {
	const match = /^(?:kitsu[-:])?(\d+)$/.exec(animeid.trim());
	if (!match) return null;
	const id = parseInt(match[1], 10);
	return Number.isInteger(id) && id > 0 ? id : null;
}

async function fromStremioAddon(animeid: string): Promise<AnimeInfoResponse | null> {
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

		const meta = response.data?.meta;
		if (!meta?.name) return null;

		return {
			title: meta.name,
			description: meta.description ?? '',
			poster: meta.poster ?? '',
			backdrop: meta.background ?? '',
			imdbid: meta.imdb_id ?? '',
			imdbRating: parseFloat(meta.imdbRating ?? '0'),
		};
	} catch {
		return null;
	}
}

/**
 * The addon is community-run and has no SLA. Kitsu publishes the same
 * catalogue, so its outage costs the rating's provenance rather than the whole
 * page. Kitsu has no IMDb id of its own; the local table supplies it.
 */
async function fromKitsu(animeid: string): Promise<AnimeInfoResponse | null> {
	const kitsuId = parseKitsuId(animeid);
	if (kitsuId === null) return null;

	const meta = await fetchKitsuAnime(kitsuId);
	if (!meta) return null;

	let imdbid = '';
	try {
		imdbid = (await db.getImdbIdByKitsuId(kitsuId)) ?? '';
	} catch {
		imdbid = '';
	}

	return {
		title: meta.title,
		description: meta.description,
		poster: meta.poster,
		backdrop: meta.backdrop,
		imdbid,
		imdbRating: meta.rating,
	};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { animeid } = req.query;

	if (!animeid || typeof animeid !== 'string') {
		return res.status(400).json({ error: 'Anime ID is required' });
	}

	const info = (await fromStremioAddon(animeid)) ?? (await fromKitsu(animeid));
	return res.status(200).json(info ?? UNKNOWN);
}
