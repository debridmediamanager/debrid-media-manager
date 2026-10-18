import {
	identifyFilenamesRemembered,
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
): Promise<{ answers: Map<string, IdentifiedAnswer>; deferred: Set<string> }> {
	const out = new Map<string, IdentifiedAnswer>();
	const found = await named(movie, filenames);
	// unreachable: every name goes on to Jev, as before the identifier was asked
	if (!found) return { answers: out, deferred: new Set() };
	for (const [name, { answer, top, ours }] of found.named) {
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
	return { answers: out, deferred: found.deferred };
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
 *
 * On the first screens of every Trakt show (2026-10-18), 5 of 40 trusted
 * releases it would have trashed were the show's own: NCIS's `Season 4 Episodes
 * 1-24` as Episodes (2011), `Ковчег / The Ark / Сезон: 3` as From, `24 Season 1`
 * as 24: India. So a release that names the show is trashed only when the other
 * title is the show's name and more, and the filename carries all of it: Big
 * Brother Canada, Love Is Blind: Germany, Law & Order: Organized Crime.
 */
export async function identifiedShowVerdicts(
	show: { imdbId: string; titles: string[] },
	filenames: string[]
): Promise<{ verdicts: Map<string, Verdict>; deferred: Set<string> } | null> {
	const found = await named(show, filenames);
	if (!found) return null;
	const ownTitles = show.titles.map(fold).filter((t) => t.trim().length >= 2);
	const verdicts = new Map<string, Verdict>();
	for (const [name, { top, ours }] of found.named) {
		if (ours) {
			verdicts.set(name, 'keep');
			continue;
		}
		const folded = fold(name);
		const shown = ownTitles.filter((t) => folded.includes(t));
		const other = fold(top.title);
		if (shown.length > 0) {
			if (!shown.some((t) => other.includes(t))) continue;
			if (!folded.includes(withoutArticle(top.title))) continue;
		}
		verdicts.set(name, 'trash');
	}
	return { verdicts, deferred: found.deferred };
}

/**
 * New names one pass may ask about; the rest wait for the page's next view. A
 * 1,000-name batch keeps the service busy for about 8 s per kind, and pages run
 * to thousands of names.
 */
export const IDENTIFY_PER_PASS = 300;

type Named = { answer: IdentifierResult; top: IdentifierMatch; ours: boolean };

/**
 * content-identifier's confident answers that name the page's own title or
 * another work. Another work sharing one of the page's titles is left out:
 * Deadpool (2013), Gravity (2010), Scarface (1932) and Traffic (2004) were the
 * identifier's mistakes for the films themselves. So is a title with no letters
 * (`1920` for `2008.myHD.Taken...1920x1080`). `deferred` holds the names left
 * for a later pass; `null` when content-identifier could not be asked.
 */
async function named(
	page: { imdbId: string; titles: string[] },
	filenames: string[]
): Promise<{ named: Map<string, Named>; deferred: Set<string> } | null> {
	const out = new Map<string, Named>();
	if (filenames.length === 0) return { named: out, deferred: new Set() };
	const asked = await identifyFilenamesRemembered(filenames, IDENTIFY_PER_PASS);
	if (!asked) return null;
	const deferred = new Set(filenames.filter((name) => !asked.answers.has(name)));
	const ownTitles = new Set(page.titles.map(withoutArticle));
	filenames.forEach((name) => {
		const answer = asked.answers.get(name);
		if (!answer) return;
		const top = answer.matches[0];
		if (!answer.confident || !top || refused(name, answer)) return;
		if (top.imdbId === page.imdbId) return out.set(name, { answer, top, ours: true });
		if (ownTitles.has(withoutArticle(top.title)) || !/\p{L}/u.test(top.title)) return;
		out.set(name, { answer, top, ours: false });
	});
	return { named: out, deferred };
}

const withoutArticle = (title: string) => fold(title).replace(/^ (?:the|a|an) /, ' ');
