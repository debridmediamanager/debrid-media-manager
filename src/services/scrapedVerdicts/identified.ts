import { identifyFilenames, refused, VIDEO } from '@/services/contentIdentifier';

/**
 * The filenames content-identifier confidently names as this movie, with the
 * library's guards and a video tag, kept without asking Jev. On 4,000 random
 * filenames that went to Jev (2026-10-18) this settled 60%, and of the 15
 * Jev trashed the identifier was right on 11 (`Maman.j.ai.encore.rate.l.avion`
 * is Home Alone 2) and kept a Grand Prix, another part of a two-parter and two
 * adult clips. The video tag leaves games and soundtracks named after the film
 * to Jev. An answer naming another movie is not used: packs that hold this one
 * and the identifier's own misses made a sixth of those wrong.
 */
export async function namedAsMovie(imdbId: string, filenames: string[]): Promise<Set<string>> {
	const answers = filenames.length ? await identifyFilenames(filenames) : null;
	if (!answers) return new Set();
	return new Set(
		filenames.filter((name, i) => {
			const answer = answers[i];
			return (
				answer.confident &&
				answer.kind !== 'tv' &&
				answer.matches[0]?.imdbId === imdbId &&
				!refused(name, answer) &&
				VIDEO.test(name)
			);
		})
	);
}
