import { repository as db } from '@/services/repository';
import type { CastProvider } from './castAddonResponses';
import { MAX_OTHER_STREAMS_LIMIT, SPONSOR_MAX_OTHER_STREAMS_LIMIT } from './sponsorLimits';

/**
 * The "other streams" limit a cast profile actually gets.
 *
 * Anything above the standard limit is a sponsor perk. Stremio calls the stream
 * routes with nothing but the userid, so trusting the stored value let a sponsor
 * who saved 10 keep it after their pledge ended. Above the standard limit this
 * re-reads the sponsorship the saving request proved (`CastSponsorGrant`) and
 * falls back to the standard limit once it has lapsed, or when there is no grant.
 *
 * The key version is not compared: a key reset revokes tokens, not the
 * sponsorship. A lookup that fails answers the standard limit rather than
 * failing the stream list. Profiles at or below the standard limit, which is
 * nearly all of them, never reach the database here; the rest cost two indexed
 * reads on a route already limited to one request per item every five seconds.
 */
export async function effectiveOtherStreamsLimit(
	service: CastProvider,
	userId: string,
	stored: number | null | undefined
): Promise<number> {
	const limit = Math.max(0, stored ?? MAX_OTHER_STREAMS_LIMIT);
	if (limit <= MAX_OTHER_STREAMS_LIMIT) return limit;

	try {
		const shortId = await db.getCastSponsorGrant(service, userId);
		const sponsor = shortId ? await db.getSponsorByShortId(shortId) : null;
		return sponsor?.isSponsor
			? Math.min(limit, SPONSOR_MAX_OTHER_STREAMS_LIMIT)
			: MAX_OTHER_STREAMS_LIMIT;
	} catch {
		return MAX_OTHER_STREAMS_LIMIT;
	}
}

/**
 * After a save, records which sponsorship allowed the limit it stored, or drops
 * the grant when the limit no longer needs one. `saved` undefined means the save
 * left the limit alone, so the grant stays as it was.
 */
export async function recordOtherStreamsGrant(
	service: CastProvider,
	userId: string,
	saved: number | undefined,
	sponsorShortId: string | null
): Promise<void> {
	if (saved === undefined) return;
	if (saved > MAX_OTHER_STREAMS_LIMIT) {
		await db.setCastSponsorGrant(service, userId, sponsorShortId);
		return;
	}
	// Best effort: a grant is only read while the stored limit is above 5, so a
	// stale one is inert, and every settings sync sends the limit - failing here
	// would fail every member's save, not just a sponsor's.
	try {
		await db.setCastSponsorGrant(service, userId, null);
	} catch (error) {
		console.error(
			'Failed to drop a cast sponsor grant:',
			error instanceof Error ? error.message : String(error)
		);
	}
}
