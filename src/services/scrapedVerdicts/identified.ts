import { identifyFilenamesRemembered, refused, VIDEO } from '@/services/contentIdentifier';
import { fold, foundTitles, type Media, type MovieContext, type TitleMatch } from './rules';

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
 *   keep when it is a set holding this movie. Another work sharing this movie's
 *   title is left to Jev: Deadpool (2013), Gravity (2010), Scarface (1932) and
 *   Traffic (2004) were the identifier's mistakes for the films themselves. So
 *   is a title with no letters (`1920` for `2008.myHD.Taken...1920x1080`), and
 *   a show whose title the filename lacks: 4 of 52 were wrong (Primal for a
 *   Hotel Transylvania release, The Continental for a John Wick box set).
 */
export async function identifiedAnswers(
	movie: MovieContext,
	filenames: string[]
): Promise<{ answers: Map<string, IdentifiedAnswer>; deferred: Set<string> }> {
	const out = new Map<string, IdentifiedAnswer>();
	const asked = filenames.length
		? await identifyFilenamesRemembered(filenames, IDENTIFY_PER_PASS)
		: null;
	// unreachable: every name goes on to Jev, as before the identifier was asked
	if (!asked) return { answers: out, deferred: new Set() };
	const deferred = new Set(filenames.filter((name) => !asked.answers.has(name)));
	const ownTitles = new Set(movie.titles.map(withoutArticle));
	filenames.forEach((name) => {
		const answer = asked.answers.get(name);
		if (!answer) return;
		const top = answer.matches[0];
		if (!answer.confident || !top || refused(name, answer)) return;
		const video = VIDEO.test(name);
		if (top.imdbId === movie.imdbId) {
			if (video) out.set(name, { media: 'FILM', titleMatch: 'SAME_TITLE' });
			return;
		}
		const title = withoutArticle(top.title);
		if (ownTitles.has(title) || !/\p{L}/u.test(top.title)) return;
		if (answer.kind === 'tv' && !fold(name).includes(title)) return;
		out.set(name, {
			media: answer.kind === 'tv' ? 'TV' : video ? 'FILM' : 'UNCLEAR',
			titleMatch: foundTitles(name, movie.titles).length ? 'DIFFERENT_TITLE' : 'NO_TITLE',
		});
	});
	return { answers: out, deferred };
}

/**
 * New names one pass may ask about; the rest wait for the page's next view. A
 * 1,000-name batch keeps the service busy for about 8 s per kind, and pages run
 * to thousands of names.
 */
export const IDENTIFY_PER_PASS = 300;

const withoutArticle = (title: string) => fold(title).replace(/^ (?:the|a|an) /, ' ');
