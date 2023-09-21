import { cleanSearchQuery } from '@/utils/search';
import fs from 'fs';
import { flattenAndRemoveDuplicates, groupByParsedTitle, scrapeBtdigg } from './btdigg-v2';
import { scrapeJackett } from './jackett';
import { ScrapeSearchResult } from './mediasearch';
import { PlanetScaleCache } from './planetscale';

let wordSet: Set<string>;
try {
	let data = fs.readFileSync('./wordlist.txt', 'utf8');
	wordSet = new Set(data.toLowerCase().split('\n'));
} catch (err) {
	console.error('error loading wordlist', err);
}

type MovieScrapeJob = {
	title: string;
	originalTitle?: string;
	cleanedTitle?: string;
	year?: string;
	airDate: string;
};

const countUncommonWordsInTitle = (title: string) => {
	let processedTitle = title
		.split(/\s+/)
		.map((word: string) =>
			word.toLowerCase().replace(/'s/g, '').replace(/&/g, 'and').replaceAll(/[\W]+/g, '')
		);
	return processedTitle.filter((word: string) => !wordSet.has(word)).length;
};

async function scrapeAll(
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult[][]> {
	return await Promise.all([
		scrapeBtdigg(finalQuery, targetTitle, mustHaveTerms, airDate),
		scrapeJackett(finalQuery, targetTitle, mustHaveTerms, airDate),
	]);
}

const getMovieSearchResults = async (job: MovieScrapeJob) => {
	let sets: ScrapeSearchResult[][] = [];
	const hasUncommonWords = countUncommonWordsInTitle(job.title) >= 1;

	if (job.title.includes('&')) {
		sets.push(
			...(await scrapeAll(
				`"${job.title.replaceAll('&', 'and')}" ${job.year ?? ''}`,
				job.title,
				[],
				job.airDate
			))
		);
	} else {
		sets.push(
			...(await scrapeAll(`"${job.title}" ${job.year ?? ''}`, job.title, [], job.airDate))
		);
	}
	if (job.title.split(/\s/).length > 3 || hasUncommonWords) {
		sets.push(...(await scrapeAll(`"${job.title}"`, job.title, [], job.airDate)));
	}

	if (job.originalTitle) {
		sets.push(
			...(await scrapeAll(
				`"${job.originalTitle}" ${job.year ?? ''}`,
				job.originalTitle,
				[],
				job.airDate
			))
		);
		if (hasUncommonWords) {
			sets.push(
				...(await scrapeAll(`"${job.originalTitle}"`, job.originalTitle, [], job.airDate))
			);
		}
	}

	if (job.cleanedTitle) {
		sets.push(
			...(await scrapeAll(
				`"${job.cleanedTitle}" ${job.year ?? ''}`,
				job.cleanedTitle,
				[],
				job.airDate
			))
		);
		if (hasUncommonWords) {
			sets.push(
				...(await scrapeAll(`"${job.cleanedTitle}"`, job.cleanedTitle, [], job.airDate))
			);
		}
	}

	return sets;
};

export async function scrapeMovies(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache
): Promise<number> {
	console.log(`🏹 Scraping movie: ${tmdbData.title} (${imdbId})...`);
	const cleanTitle = cleanSearchQuery(tmdbData.title);
	const year =
		mdbData.year ?? mdbData.released?.substring(0, 4) ?? tmdbData.release_date?.substring(0, 4);
	const airDate = mdbData.released ?? tmdbData.release_date ?? '2000-01-01';
	let originalTitle, cleanedTitle;

	const processedTitle = tmdbData.title
		.split(' ')
		.map((word: string) => word.replaceAll(/[\W]+/g, ''))
		.join(' ')
		.trim()
		.toLowerCase();

	if (
		tmdbData.original_title &&
		tmdbData.original_title !== tmdbData.title &&
		mdbData.ratings?.length
	) {
		originalTitle = tmdbData.original_title.toLowerCase();
		for (let rating of mdbData.ratings) {
			if (rating.source === 'tomatoes') {
				if (!rating.url) continue;
				let tomatoTitle = rating.url.split('/').pop();
				if (tomatoTitle.match(/^\d{6,}/)) continue;
				tomatoTitle = tomatoTitle
					.split('_')
					.map((word: string) => word.replaceAll(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (tomatoTitle !== processedTitle) {
					console.log('🎯 Found another title (1):', tomatoTitle);
					cleanedTitle = tomatoTitle;
				}
			}
		}
	}

	let anotherTitle;
	if (mdbData.ratings?.length) {
		for (let rating of mdbData.ratings) {
			if (rating.source === 'metacritic') {
				if (!rating.url) continue;
				let metacriticTitle = rating.url.split('/').pop();
				metacriticTitle = metacriticTitle
					.split('-')
					.map((word: string) => word.replaceAll(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (metacriticTitle !== processedTitle && metacriticTitle !== cleanedTitle) {
					console.log('🎯 Found another title (2):', metacriticTitle);
					anotherTitle = metacriticTitle;
				}
			}
		}
	}

	await db.saveScrapedResults(`processing:${imdbId}`, []);

	const searchResults = await getMovieSearchResults({
		title: cleanTitle,
		originalTitle,
		cleanedTitle,
		year,
		airDate,
	});
	if (anotherTitle) {
		searchResults.push(
			...(await getMovieSearchResults({
				title: anotherTitle,
				originalTitle: undefined,
				cleanedTitle: undefined,
				year,
				airDate,
			}))
		);
	}
	let processedResults = flattenAndRemoveDuplicates(searchResults);
	if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

	await db.saveScrapedResults<ScrapeSearchResult[]>(`movie:${imdbId}`, processedResults);
	console.log(`🎥 Saved ${processedResults.length} results for ${cleanTitle}`);

	await db.markAsDone(imdbId);

	return processedResults.length;
}
