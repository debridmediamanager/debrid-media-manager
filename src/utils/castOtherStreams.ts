/** One slot of a stream list's "other streams": a member's cast, or a cached scraped release. */
export type OtherStreamPick<C, T> = { cast: C; trove?: undefined } | { cast?: undefined; trove: T };

/**
 * Members' casts and cached scraped releases in one "other streams" budget.
 *
 * The newest cast comes first: what a member cast last is the copy someone
 * just chose and played. Everything after it is biggest first, the order the
 * size-limits setting describes ("Biggest available"). Casts used to take
 * every slot before a scraped release got one, so a film with five casts never
 * showed a bigger copy the provider had cached: on 2026-11-07 TorBox listed
 * The Odyssey's five casts, the largest 82.84 GB, and left out a cached
 * 96.9 GB release. A cast keeps its place over a release of the same size.
 */
export function biggestOtherStreams<
	C extends { size: number; castAt?: Date },
	T extends { sizeMb: number },
>(casts: C[], trove: T[], limit: number): OtherStreamPick<C, T>[] {
	if (limit <= 0) return [];
	const newest = casts.reduce<C | undefined>(
		(best, cast) => (cast.castAt && (!best?.castAt || cast.castAt > best.castAt) ? cast : best),
		undefined
	);
	const rest = [
		...casts
			.filter((cast) => cast !== newest)
			.map((cast) => ({ pick: { cast }, mb: cast.size })),
		...trove.map((release) => ({ pick: { trove: release }, mb: release.sizeMb })),
	]
		.sort((a, b) => b.mb - a.mb)
		.map(({ pick }) => pick as OtherStreamPick<C, T>);
	return (newest ? [{ cast: newest } as OtherStreamPick<C, T>, ...rest] : rest).slice(0, limit);
}
