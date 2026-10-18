import {
	identifyFilenames,
	refused,
	VIDEO,
	type IdentifierMatch,
	type IdentifierResult,
} from '@/services/contentIdentifier';
import {
	fold,
	foundTitles,
	type Media,
	type MovieContext,
	type TitleMatch,
	type Verdict,
} from './rules';

export type IdentifiedAnswer = { media: Media; titleMatch: TitleMatch };

/**
 * Jev's two answers, read from content-identifier where it is confident, so the
 * rules decide those filenames and only the rest go to Jev. On 4,000 random
 * filenames that went to Jev (2026-10-18) this settled 71%, and where its
 * verdict differed from Jev's (41) it was the right one 33 times.
 *
 * - Named as this movie, with a video tag: the film itself. Of the 15 Jev
 *   trashed the identifier was right on 11 (`Maman.j.ai.encore.rate.l.avion` is
 *   Home Alone 2). Without a video tag it is often a game or a soundtrack.
 * - Named as another movie or a show: a different title, which the rules still
 *   keep when it is a set holding this movie. A show whose title the filename
 *   lacks is left to Jev: 4 of 52 were wrong (Primal for a Hotel Transylvania
 *   release, The Continental for a John Wick box set).
 */
export async function identifiedAnswers(
	movie: MovieContext,
	filenames: string[]
): Promise<Map<string, IdentifiedAnswer>> {
	const out = new Map<string, IdentifiedAnswer>();
	for (const [name, { answer, top, ours }] of (await named(movie, filenames)) ?? []) {
		const video = VIDEO.test(name);
		if (ours) {
			if (video) out.set(name, { media: 'FILM', titleMatch: 'SAME_TITLE' });
			continue;
		}
		if (answer.kind === 'tv' && !fold(name).includes(withoutArticle(top.title))) continue;
		out.set(name, {
			media: answer.kind === 'tv' ? 'TV' : video ? 'FILM' : 'UNCLEAR',
			titleMatch: foundTitles(name, movie.titles).length ? 'DIFFERENT_TITLE' : 'NO_TITLE',
		});
	}
	return out;
}

/**
 * Whether each release on a show's page is the show, where content-identifier
 * is confident, with the same guards as for movies. Of 100 random releases on
 * show pages (2026-10-18) it named as another title, it was wrong on one
 * (`有匪·破雪斩.Legend.of.Fei.2021` as a film on Legend of Fei's page): the rest
 * were Power Book II: Ghost on a page called Ghost, 90 Day Fiancé UK on 90 Day
 * Fiancé, films and other shows sharing a word with the title. Another show of
 * the same title is left alone although it was right every time (The Boys 2019
 * on a 1993 show's page), so a lesser-known show never loses its own releases
 * to its famous namesake. `null` when content-identifier could not be asked.
 */
export async function identifiedShowVerdicts(
	show: { imdbId: string; titles: string[] },
	filenames: string[]
): Promise<Map<string, Verdict> | null> {
	const found = await named(show, filenames);
	if (!found) return null;
	return new Map([...found].map(([name, { ours }]) => [name, ours ? 'keep' : 'trash']));
}

type Named = { answer: IdentifierResult; top: IdentifierMatch; ours: boolean };

/**
 * content-identifier's confident answers that name the page's own title or
 * another work. Another work sharing one of the page's titles is left out:
 * Deadpool (2013), Gravity (2010), Scarface (1932) and Traffic (2004) were the
 * identifier's mistakes for the films themselves. So is a title with no letters
 * (`1920` for `2008.myHD.Taken...1920x1080`). `null` when content-identifier
 * could not be asked.
 */
async function named(
	page: { imdbId: string; titles: string[] },
	filenames: string[]
): Promise<Map<string, Named> | null> {
	const out = new Map<string, Named>();
	if (filenames.length === 0) return out;
	const answers = await identifyFilenames(filenames);
	if (!answers) return null;
	const ownTitles = new Set(page.titles.map(withoutArticle));
	filenames.forEach((name, i) => {
		const answer = answers[i];
		const top = answer.matches[0];
		if (!answer.confident || !top || refused(name, answer)) return;
		if (top.imdbId === page.imdbId) return out.set(name, { answer, top, ours: true });
		if (ownTitles.has(withoutArticle(top.title)) || !/\p{L}/u.test(top.title)) return;
		out.set(name, { answer, top, ours: false });
	});
	return out;
}

const withoutArticle = (title: string) => fold(title).replace(/^ (?:the|a|an) /, ' ');
