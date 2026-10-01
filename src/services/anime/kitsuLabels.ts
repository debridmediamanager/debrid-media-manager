import { BoundedTtlCache } from '@/utils/boundedTtlCache';
import type { KitsuLabel } from './animeEntries';
import { fetchKitsuAnime } from './kitsu';

// A season Kitsu has lists its title for good; a day is plenty.
const LABEL_TTL_MS = 24 * 60 * 60 * 1000;
const LABEL_MAX_ENTRIES = 5000;
const labels = new BoundedTtlCache<KitsuLabel | null>(LABEL_TTL_MS, LABEL_MAX_ENTRIES);

/**
 * A title and poster from Kitsu for an AniDB entry the `Anime` table has no
 * row for, cached so a show page's reload does not ask again. A failed lookup
 * is not cached: it may be an outage rather than an absent entry.
 */
export async function getKitsuLabel(kitsuId: number): Promise<KitsuLabel | null> {
	const key = String(kitsuId);
	const hit = labels.get(key);
	if (hit !== undefined) return hit;
	const meta = await fetchKitsuAnime(kitsuId);
	if (!meta) return null;
	const label = { title: meta.title, poster: meta.poster };
	labels.set(key, label);
	return label;
}
