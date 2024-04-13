import { ScrapeResponse } from '@/pages/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import { computeHashFromTorrent } from '@/utils/extractHashFromTorrent';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const db = new PlanetScaleCache();
const tlUrl = (imdbId: string, page: number = 1) =>
	`https://www.torrentleech.org/torrents/browse/list/imdbID/${imdbId}/page/${page}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { tluid, tlpass, rssPass, mediaType } = req.query;
	let imdbIds = (await db.getAllImdbIds(`${mediaType}` as 'movie' | 'tv')) ?? [];
	// let imdbIds = ['tt0944947'];
	// shuffle the array
	imdbIds.sort(() => Math.random() - 0.5);
	for (const imdbId of imdbIds) {
		const index = imdbIds.indexOf(imdbId);
		const percentage = Math.round((index / imdbIds.length) * 100);
		const scrapesMap = new Map<string, any>();
		const tlConfig = {
			headers: {
				accept: '*/*',
				'accept-language': 'en-US,en;q=0.9',
				'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
				'sec-ch-ua-mobile': '?0',
				'sec-ch-ua-platform': 'macOS',
				'sec-fetch-dest': 'empty',
				'sec-fetch-mode': 'cors',
				'sec-fetch-site': 'same-origin',
				'upgrade-insecure-requests': '1',
				'user-agent': new UserAgent().toString(),
				cookie: `tluid=${tluid}; tlpass=${tlpass};`,
			},
		};
		try {
			const response = await axios.get(tlUrl(imdbId), tlConfig);
			let tlLinks: ScrapeSearchResult[] = (response.data.torrentList || []).map((e: TlItem) =>
				processStream(e, imdbId, rssPass as string)
			);
			if (tlLinks.length === 0) {
				console.log(`[torrentleech] ${imdbId} has no links`);
				continue;
			}

			const totalCount = response.data.numFound ?? 0;
			while (tlLinks.length < totalCount) {
				const nextPage = Math.floor(tlLinks.length / 100) + 1;
				await new Promise((resolve) => setTimeout(resolve, 1000));
				console.log(`[torrentleech] ${imdbId} fetching page ${nextPage}`);
				const nextResponse = await axios.get(tlUrl(imdbId, nextPage), tlConfig);
				tlLinks = tlLinks.concat(
					(nextResponse.data.torrentList || []).map((e: TlItem) =>
						processStream(e, imdbId, rssPass as string)
					)
				);
			}
			for (const link of tlLinks) {
				let newHash = await computeHashFromTorrent(link.hash);
				if (newHash) {
					link.hash = newHash;
					console.log(`[torrentleech] ${imdbId} hash: ${newHash}`);
				} else {
					link.hash = 'error';
					console.log(`[torrentleech] ${imdbId} hash: error`);
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			tlLinks = tlLinks.filter(
				(e: ScrapeSearchResult | null) => e !== null && e.hash !== 'error'
			);

			console.log(
				`[torrentleech] ${imdbId} has ${tlLinks.length} links ${percentage}% (${index}/${imdbIds.length})`
			);

			if (mediaType === 'movie') {
				scrapesMap.set(`movie:${imdbId}`, tlLinks);
			} else if (mediaType === 'tv') {
				for (let i = 0; i < tlLinks.length; i++) {
					let seasonNum: number | null = null;
					const seasonMatch =
						tlLinks[i].title.match(/S(\d{1,2})E?/i) ||
						tlLinks[i].title.match(/S[a-z]+n\s?(\d{1,2})/i) ||
						tlLinks[i].title.match(/(\d{1,2})x\d{1,2}/i);

					if (seasonMatch && seasonMatch[1]) {
						seasonNum = parseInt(seasonMatch[1], 10);
					} else {
						console.warn('No season match, setting to 1', tlLinks[i].title);
						seasonNum = 1; // Default to season 1 if no match is found
					}
					if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
						scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(tlLinks[i]);
					} else {
						scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [tlLinks[i]]);
					}
				}
			}
			scrapesMap.forEach(async (scrapes, key) => {
				const url = `https://debridmediamanager.com/${key
					.replaceAll(':', '/')
					.replaceAll('tv/', 'show/')}`;
				console.log(url, key, scrapes);
				await db.saveScrapedTrueResults(key, scrapes, true);
			});
		} catch (e) {
			console.log(`[torrentleech] ${imdbId} failed (${e})`);
		}
	}
	res.status(200).send({ status: 'success' });
}

interface TlItem {
	fid: number;
	filename: string;
	imdbID: string;
	size: number;
}

function processStream(item: TlItem, imdbId: string, rssPass: string): ScrapeSearchResult | null {
	if (`${item.imdbID ?? ''}` !== imdbId) {
		return null;
	}
	return {
		title: item.filename.replace(/\.torrent$/, ''),
		fileSize: item.size / 1024 / 1024,
		hash: `https://www.torrentleech.org/rss/download/${item.fid}/${rssPass}/${item.filename}`,
	};
}
