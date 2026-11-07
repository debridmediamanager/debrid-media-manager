/** One slot of a stream list's "other streams": a member's cast, or a cached scraped release. */
export type OtherStreamPick<C, T> = { cast: C; trove?: undefined } | { cast?: undefined; trove: T };

/**
 * Members' casts and cached scraped releases in one "other streams" budget,
 * biggest first, the order the size-limits setting describes ("Biggest
 * available"). Casts used to take every slot before a scraped release got one,
 * so a film with five casts never showed a bigger copy the provider had cached:
 * on 2026-11-07 TorBox listed The Odyssey's five casts, the largest 82.84 GB,
 * and left out a cached 96.9 GB release. A cast keeps its place over a release
 * of the same size.
 */
export function biggestOtherStreams<C extends { size: number }, T extends { sizeMb: number }>(
	casts: C[],
	trove: T[],
	limit: number
): OtherStreamPick<C, T>[] {
	return [
		...casts.map((cast) => ({ pick: { cast }, mb: cast.size })),
		...trove.map((release) => ({ pick: { trove: release }, mb: release.sizeMb })),
	]
		.sort((a, b) => b.mb - a.mb)
		.slice(0, Math.max(0, limit))
		.map(({ pick }) => pick as OtherStreamPick<C, T>);
}
