import { countUncommonWords, naked } from '@/utils/checks';
import { cleanSearchQuery, liteCleanSearchQuery } from '@/utils/search';
import { scrapeBtdigg } from './btdigg-v2';
import { scrapeJackett } from './jackett';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { PlanetScaleCache } from './planetscale';
import { scrapeProwlarr } from './prowlarr';

type MovieScrapeJob = {
	title: string;
	originalTitle?: string;
	cleanedTitle?: string;
	year?: string;
	airDate: string;
};

async function scrapeAll(
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult[][]> {
	return await Promise.all([
		scrapeBtdigg(finalQuery, targetTitle, mustHaveTerms, airDate),
		scrapeProwlarr(finalQuery, targetTitle, airDate),
		scrapeJackett(finalQuery, targetTitle, airDate),
	]);
}

const getMovieSearchResults = async (job: MovieScrapeJob) => {
	let sets: ScrapeSearchResult[][] = [];
	const mustHaveFn = (title: string, year?: string) =>
		naked(title).length <= 6 && year ? [year] : [];

	let mustHave = mustHaveFn(job.title, job.year);
	if (job.title.includes(' & ')) {
		const aSets = await Promise.all([
			scrapeAll(`"${job.title}" ${job.year ?? ''}`, job.title, mustHave, job.airDate),
			scrapeAll(
				`"${job.title.replaceAll(' & ', ' and ')}" ${job.year ?? ''}`,
				job.title,
				mustHave,
				job.airDate
			),
		]);
		sets.push(...aSets.flat());
	} else {
		sets.push(
			...(await scrapeAll(
				`"${job.title}" ${job.year ?? ''}`,
				job.title,
				mustHave,
				job.airDate
			))
		);
	}
	if (
		job.title.replace(/[^a-z0-9]/gi, '').length > 5 &&
		(job.title.split(/\s/).length > 3 || countUncommonWords(job.title))
	) {
		sets.push(...(await scrapeAll(`"${job.title}"`, job.title, mustHave, job.airDate)));
	}

	if (job.originalTitle) {
		mustHave = mustHaveFn(job.originalTitle, job.year);
		sets.push(
			...(await scrapeAll(
				`"${job.originalTitle}" ${job.year ?? ''}`,
				job.originalTitle,
				mustHave,
				job.airDate
			))
		);
		if (
			job.originalTitle.replace(/[^a-z0-9]/gi, '').length > 5 &&
			countUncommonWords(job.title)
		) {
			sets.push(
				...(await scrapeAll(
					`"${job.originalTitle}"`,
					job.originalTitle,
					mustHave,
					job.airDate
				))
			);
		}
	}

	if (job.cleanedTitle) {
		mustHave = mustHaveFn(job.cleanedTitle, job.year);
		sets.push(
			...(await scrapeAll(
				`"${job.cleanedTitle}" ${job.year ?? ''}`,
				job.cleanedTitle,
				mustHave,
				job.airDate
			))
		);
		if (
			job.cleanedTitle.replace(/[^a-z0-9]/gi, '').length > 5 &&
			countUncommonWords(job.title)
		) {
			sets.push(
				...(await scrapeAll(
					`"${job.cleanedTitle}"`,
					job.cleanedTitle,
					mustHave,
					job.airDate
				))
			);
		}
	}

	return sets;
};

export async function scrapeMovies(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache,
	replaceOldScrape: boolean = false
): Promise<number> {
	const cleanTitle = cleanSearchQuery(tmdbData.title);
	const liteCleantitle = liteCleanSearchQuery(tmdbData.title);
	console.log(
		`🏹 Scraping movie: ${cleanTitle} (${imdbId}) (uncommon: ${countUncommonWords(
			tmdbData.title
		)})...`
	);
	const year =
		mdbData.year ?? mdbData.released?.substring(0, 4) ?? tmdbData.release_date?.substring(0, 4);
	const airDate = mdbData.released ?? tmdbData.release_date ?? '2000-01-01';
	let originalTitle, cleanedTitle;

	const processedTitle = tmdbData.title
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/g, ''))
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
			if (rating.source === 'tomatoes' && rating.score > 0) {
				if (!rating.url) continue;
				let tomatoTitle = rating.url.split('/').pop();
				if (tomatoTitle.match(/^\d{6,}/)) continue;
				tomatoTitle = tomatoTitle
					.split('_')
					.map((word: string) => word.replace(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (tomatoTitle !== processedTitle) {
					console.log(
						'🎯 Found another title (1):',
						tomatoTitle,
						`(uncommon: ${countUncommonWords(tomatoTitle)})`
					);
					cleanedTitle = tomatoTitle;
				}
			}
		}
	}

	let anotherTitle;
	if (mdbData.ratings?.length) {
		for (let rating of mdbData.ratings) {
			if (rating.source === 'metacritic' && rating.score > 0) {
				if (!rating.url) continue;
				let metacriticTitle = rating.url.split('/').pop();
				if (metacriticTitle.startsWith('-')) continue;
				metacriticTitle = metacriticTitle
					.split('-')
					.map((word: string) => word.replace(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (metacriticTitle !== processedTitle && metacriticTitle !== cleanedTitle) {
					console.log(
						'🎯 Found another title (2):',
						metacriticTitle,
						`(uncommon: ${countUncommonWords(metacriticTitle)})`
					);
					anotherTitle = metacriticTitle;
				}
			}
		}
	}
	if (cleanTitle !== liteCleantitle) {
		console.log('🎯 Trying with symbols (3):', liteCleantitle);
	}

	await db.saveScrapedResults(`processing:${imdbId}`, []);

	const searchResults = await getMovieSearchResults({
		title: cleanTitle,
		originalTitle,
		cleanedTitle,
		year,
		airDate,
	});
	if (cleanTitle !== liteCleantitle) {
		searchResults.push(
			...(await getMovieSearchResults({
				title: liteCleantitle,
				originalTitle: undefined,
				cleanedTitle: undefined,
				year,
				airDate,
			}))
		);
	}
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
	// extra conditions based on media type = movie
	processedResults = processedResults.filter((result) => !/s\d\de\d\d/i.test(result.title));
	processedResults = processedResults.filter(
		(result) => result.fileSize < 200000 && result.fileSize > 500
	);
	if (processedResults.length) processedResults = sortByFileSize(processedResults);

	await db.saveScrapedResults(`movie:${imdbId}`, processedResults, replaceOldScrape);
	console.log(`🎥 Saved ${processedResults.length} results for ${cleanTitle}`);

	await db.markAsDone(imdbId);

	return processedResults.length;
}
