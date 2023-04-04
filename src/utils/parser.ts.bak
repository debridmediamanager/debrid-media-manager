import { languageParser, qualityParser } from './parsers';
import {
	getReleaseHash,
	getSubGroup,
	parseEdition,
	parseHardcodeSubs,
	parseImdbId,
	parseMovieMatchCollection,
	parseReleaseGroup,
	parseTmdbId,
} from './parsingHelpers';
import {
	cleanQualityBracketsRegex,
	cleanTorrentSuffixRegex,
	preSubstitutionRegex,
	removeFileExtension,
	reportMovieTitleFolderRegex,
	reportMovieTitleRegex,
	reversedTitleRegex,
	simpleReleaseTitleRegex,
	simpleTitleRegex,
	validateBeforeParsing,
	websitePostfixRegex,
	websitePrefixRegex,
} from './regexHelpers';

interface ParsedMovieInfo {
	releaseGroup?: string;
	hardcodedSubs?: string;
	languages?: string[];
	quality?: string;
	edition?: string;
	releaseHash?: string;
	originalTitle?: string;
	releaseTitle?: string;
	simpleReleaseTitle?: string;
	imdbId?: string;
	tmdbId?: string;
	primaryMovieTitle?: string;
}

class InvalidDateException extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidDateException';
	}
}

async function parseMovieTitle(
	title: string,
	isDir: boolean = false
): Promise<ParsedMovieInfo | null> {
	const originalTitle = title;
	try {
		if (!validateBeforeParsing(title)) {
			return null;
		}

		console.debug(`Parsing string '${title}'`);

		if (reversedTitleRegex.test(title)) {
			const titleWithoutExtension = removeFileExtension(title).split('').reverse().join('');

			title = `${titleWithoutExtension}${title.substring(titleWithoutExtension.length)}`;

			console.debug(`Reversed name detected. Converted to '${title}'`);
		}

		let releaseTitle = removeFileExtension(title);

		// Trim dashes from end
		releaseTitle = releaseTitle.trim('-').trim('_');

		releaseTitle = releaseTitle.replace('【', '[').replace('】', ']');

		for (const replace of preSubstitutionRegex) {
			if (replace.tryReplace(releaseTitle)) {
				console.trace(`Replace regex: ${replace}`);
				console.debug(`Substituted with ${releaseTitle}`);
			}
		}

		let simpleTitle = simpleTitleRegex.replace(releaseTitle);

		// TODO: Quick fix stripping [url] - prefixes.
		simpleTitle = websitePrefixRegex.replace(simpleTitle);
		simpleTitle = websitePostfixRegex.replace(simpleTitle);

		simpleTitle = cleanTorrentSuffixRegex.replace(simpleTitle);

		simpleTitle = cleanQualityBracketsRegex.replace(simpleTitle, (m) => {
			if (qualityParser.parseQualityName(m).quality !== Qualities.Unknown) {
				return '';
			}

			return m;
		});

		let allRegexes = reportMovieTitleRegex.slice();

		if (isDir) {
			allRegexes.push(...reportMovieTitleFolderRegex);
		}

		for (const regex of allRegexes) {
			const matches = regex.exec(simpleTitle);

			if (matches) {
				console.trace(regex);
				try {
					const result = parseMovieMatchCollection(matches);

					if (result) {
						// TODO: Add tests for this!
						let simpleReleaseTitle = simpleReleaseTitleRegex.replace(releaseTitle, '');

						const simpleTitleReplaceString = matches.groups.title
							? matches.groups.title
							: result.primaryMovieTitle;

						if (simpleTitleReplaceString) {
							if (matches.groups.title) {
								simpleReleaseTitle =
									simpleReleaseTitle.slice(0, matches.groups.title.index) +
									simpleTitleReplaceString.includes('.')
										? 'A.Movie'
										: 'A Movie' +
										  simpleReleaseTitle.slice(
												matches.groups.title.index +
													matches.groups.title.length
										  );
							} else {
								simpleReleaseTitle = simpleReleaseTitle.replace(
									simpleTitleReplaceString,
									simpleTitleReplaceString.includes('.') ? 'A.Movie' : 'A Movie'
								);
							}
						}

						result.releaseGroup = parseReleaseGroup(simpleReleaseTitle);

						const subGroup = getSubGroup(matches);
						if (subGroup) {
							result.releaseGroup = subGroup;
						}

						result.hardcodedSubs = parseHardcodeSubs(title);

						console.debug(`Release Group parsed: ${result.releaseGroup}`);

						result.languages = languageParser.parseLanguages(
							result.releaseGroup
								? simpleReleaseTitle.replace(result.releaseGroup, 'RlsGrp')
								: simpleReleaseTitle
						);
						console.debug(`Languages parsed: ${result.languages.join(', ')}`);
						result.quality = qualityParser.parseQuality(title);
						console.debug(`Quality parsed: ${result.quality}`);

						if (!result.edition) {
							result.edition = parseEdition(simpleReleaseTitle);
							console.debug(`Edition parsed: ${result.edition}`);
						}

						result.releaseHash = getReleaseHash(matches);
						if (result.releaseHash) {
							console.debug(`Release Hash parsed: ${result.releaseHash}`);
						}

						result.originalTitle = originalTitle;
						result.releaseTitle = releaseTitle;
						result.simpleReleaseTitle = simpleReleaseTitle;

						result.imdbId = parseImdbId(simpleReleaseTitle);
						result.tmdbId = parseTmdbId(simpleReleaseTitle);

						return result;
					}
				} catch (error) {
					if (error instanceof InvalidDateException) {
						console.debug(error, error.message);
						break;
					}
				}
			}
		}
	} catch (error) {
		if (!title.toLowerCase().includes('password') && !title.toLowerCase().includes('yenc')) {
			console.error(`An error has occurred while trying to parse ${title}`, error);
		}
	}

	console.debug(`Unable to parse ${title}`);
	return null;
}

export { parseMovieTitle };
