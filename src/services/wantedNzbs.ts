import { deleteStoredNzb } from '@/services/newznab/store';
import { repository as db } from '@/services/repository';
import { WANTED_NZB_PREFIX } from '@/services/wantedHistory';

/** Uploads removed in one cron run. */
const PRUNED_AT_ONCE = 200;

/**
 * Removes the uploaded NZBs no event names any more (their events are pruned after
 * 180 days, and a later grab of an upload names it again). The object goes first and
 * its row only once it is gone, so a row never outlives its object: one the store
 * could not delete is tried again on the next run. Answers how many were removed.
 */
export async function pruneWantedNzbs(): Promise<number> {
	let pruned = 0;
	// ponytail: an event naming the sha that lands between this read and the delete loses that upload; DMM asks for it again with the next grab
	for (const sha of await db.unreferencedWantedNzbs(PRUNED_AT_ONCE)) {
		if (!(await deleteStoredNzb(WANTED_NZB_PREFIX, sha))) continue;
		await db.forgetWantedNzb(sha);
		pruned++;
	}
	return pruned;
}
