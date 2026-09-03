import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Every watch call site must hand over every credential the user holds.
 *
 * `pickWatchService` answers from the keys it is given, so a partial set does
 * not degrade - it reports "nothing here is watchable" for a service that holds
 * the release, and the button goes dead for anyone signed in only to the
 * omitted one. It fails silently, and it fails only for the users with the
 * fewest services, which is how it survived a provider addition: the movie
 * page's "Watch first" was handed `{ rdKey, adKey, torboxKey }` and was
 * therefore dead for Premiumize from the day Premiumize shipped, and would have
 * shipped dead for Offcloud too.
 *
 * A unit test on `pickWatchService` cannot catch that - the function is
 * correct. The bug lives at the call sites, so this reads them.
 *
 * The two lists differ on purpose. `pickWatchService` *chooses* a service from
 * an availability flag, and Debrid-Link publishes no cache probe, so there is
 * no `dlAvailable` for it to read and `'dl'` can never be its answer - passing
 * `debridLinkKey` there would be noise. `openWatch` *redeems* a choice made
 * anywhere, including a library row or a search row the user just added, so it
 * needs the Debrid-Link key like any other.
 */
describe('watch call sites carry every provider key', () => {
	/** What `openWatch` redeems with. Debrid-Link included. */
	const REDEEMABLE = [
		'rdKey',
		'adKey',
		'torboxKey',
		'premiumizeKey',
		'offcloudKey',
		'debridLinkKey',
	];

	/** What `pickWatchService` can choose between. No Debrid-Link - see above. */
	const PICKABLE = ['rdKey', 'adKey', 'torboxKey', 'premiumizeKey', 'offcloudKey'];

	const files = [
		'src/pages/movie/[imdbid]/index.tsx',
		'src/pages/show/[imdbid]/[seasonNum].tsx',
		'src/components/MovieSearchResults.tsx',
		'src/components/TvSearchResults.tsx',
	];

	/** The body of the object a `keys:` property names, literal or by variable. */
	const resolveKeysBody = (source: string, span: string): string | null => {
		const inline = span.match(/keys:\s*\{([^}]*)\}/);
		if (inline) return inline[1];

		const named = span.match(/keys:\s*([A-Za-z_$][\w$]*)/);
		if (!named) return null;

		const declared = source.match(
			new RegExp(`(?:const|let|var)\\s+${named[1]}\\s*=\\s*\\{([^}]*)\\}`)
		);
		return declared ? declared[1] : null;
	};

	const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

	// The count assertions are across the whole set rather than per file: a
	// page with no watch button has nothing to get wrong, but the set as a
	// whole must still be pointing at real call sites, or this test passes by
	// finding nothing.
	it('hands openWatch every provider key', () => {
		let checked = 0;

		for (const file of files) {
			const source = read(file);
			// `openWatch({ … })` - the inner `keys: {…}` closes with `},`,
			// never `})`, so the first `})` ends the call.
			for (const match of source.matchAll(/openWatch\(\{([\s\S]*?)\}\)/g)) {
				const body = resolveKeysBody(source, match[1]);
				expect(
					body,
					`${file} calls openWatch with no resolvable keys object`
				).not.toBeNull();

				const missing = REDEEMABLE.filter((key) => !body!.includes(key));
				expect(missing, `${file} calls openWatch missing ${missing.join(', ')}`).toEqual(
					[]
				);
				checked++;
			}
		}

		expect(checked, 'found no openWatch call sites to check').toBeGreaterThan(0);
	});

	it('hands pickWatchService every pickable key', () => {
		let checked = 0;

		for (const file of files) {
			const source = read(file);
			for (const match of source.matchAll(
				/pickWatchService\([^,)]+,\s*(\{[^}]*\}|[\w$]+)\s*\)/g
			)) {
				const argument = match[1];
				let body: string | null = argument.startsWith('{') ? argument : null;
				if (body === null) {
					const declared = source.match(
						new RegExp(`(?:const|let|var)\\s+${argument}\\s*=\\s*\\{([^}]*)\\}`)
					);
					body = declared ? declared[1] : null;
				}
				expect(
					body,
					`${file} calls pickWatchService with no resolvable keys object`
				).not.toBeNull();

				const missing = PICKABLE.filter((key) => !body!.includes(key));
				expect(
					missing,
					`${file} calls pickWatchService missing ${missing.join(', ')}`
				).toEqual([]);
				checked++;
			}
		}

		expect(checked, 'found no pickWatchService call sites to check').toBeGreaterThan(0);
	});
});
