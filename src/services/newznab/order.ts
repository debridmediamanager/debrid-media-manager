import { releaseDedupKey } from '@/services/nzb2rd';

// The order a targeted search's merged set is paged in: clean release names
// first, then reposts of a release already in the set, then posts whose title
// is a raw Usenet subject line. Clients parse a subject line badly and show a
// repost as a near-duplicate, so both go last; neither is dropped. Applied at
// page time, so entries cached before this existed are served in it too.

/**
 * The tags a reposter appends after the release group. The *arrs strip these
 * same ones before reading the group (`CleanReleaseGroupRegex` in Sonarr's and
 * Radarr's `ReleaseGroupParser.cs`), plus `FTP`, seen on real search results.
 */
const REPOSTER_SUFFIX =
	/(?:-(?:RP|1|NZBGeek|Obfuscated|Obfuscation|Scrambled|sample|Pre|postbot|xpost|Rakuv[a-z0-9]*|WhiteRev|BUYMORE|AsRequested|AlternativeToRequested|GEROV|Z0iDS3N|Chamele0n|4P|4Planet|AlteZachen|RePACKPOST|FTP))+$/i;

/** A part counter (`[01/48]`) or a quoted file name: a subject line, not a release name. */
const RAW_SUBJECT = /\[\d+\/\d+\]|"/;

export function cleanNamesFirst<T extends { title: string }>(results: T[]): T[] {
	const keys = new Set(results.map((result) => releaseDedupKey(result.title)));
	const rank = (title: string): number => {
		if (RAW_SUBJECT.test(title)) return 2;
		const original = title.replace(REPOSTER_SUFFIX, '');
		// Only a repost when the original is here too; otherwise it is the only copy.
		return original !== title && keys.has(releaseDedupKey(original)) ? 1 : 0;
	};
	// Array sort is stable, so each group keeps the merged set's order.
	return results
		.map((result) => ({ result, rank: rank(result.title) }))
		.sort((a, b) => a.rank - b.rank)
		.map(({ result }) => result);
}
