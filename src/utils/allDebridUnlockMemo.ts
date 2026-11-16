import { unlockLink, UnlockLinkData } from '@/services/allDebrid';

/**
 * Each `link/unlock` mints a new delivery link, and AllDebrid warns, then
 * suspends, accounts that mint thousands without downloading them. A Stremio
 * player on LG webOS requests the play URL again for every read: 5,517 times
 * for one film on 2026-11-16, ~50 a minute. Delivery links measured still
 * serving after 25 h, so one per account and source for 30 minutes is safe.
 */
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 10_000;

const memo = new Map<string, { at: number; unlocked: Promise<UnlockLinkData> }>();

// ponytail: per process, so each of the web replicas unlocks once; move to Redis if that matters.
export function unlockLinkOnce(apiKey: string, link: string): Promise<UnlockLinkData> {
	const key = `${apiKey}\n${link}`;
	const hit = memo.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.unlocked;

	if (memo.size >= MAX_ENTRIES) memo.delete(memo.keys().next().value!);
	const unlocked = unlockLink(apiKey, link);
	const entry = { at: Date.now(), unlocked };
	memo.set(key, entry);
	// A refusal is never kept: the next request must ask AllDebrid again.
	unlocked.catch(() => memo.get(key) === entry && memo.delete(key));
	return unlocked;
}

export const clearUnlockMemo = () => memo.clear();
