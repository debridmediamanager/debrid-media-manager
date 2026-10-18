import { identifyFilenames, refused, VIDEO } from '@/services/contentIdentifier';
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
): Promise<Map<string, IdentifiedAnswer>> {
	const answers = filenames.length ? await identifyFilenames(filenames) : null;
	const out = new Map<string, IdentifiedAnswer>();
	if (!answers) return out;
	const ownTitles = new Set(movie.titles.map(withoutArticle));
	filenames.forEach((name, i) => {
		const answer = answers[i];
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
	return out;
}

const withoutArticle = (title: string) => fold(title).replace(/^ (?:the|a|an) /, ' ');
