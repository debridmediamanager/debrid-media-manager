import { repository as db } from '@/services/repository';
import {
	blocksFor,
	countCreditedSends,
	DAYS_PER_BLOCK,
	extendEarned,
	SENDS_PER_BLOCK,
} from '@/utils/fulfillerRewards';

/**
 * Paying fulfillers in sponsor time, and the numbers the board shows them.
 *
 * Credit is recounted from the sends themselves rather than incremented, so a
 * missed or repeated call can never pay too much or too little: the next call
 * settles the difference. `SponsorEarned.creditedBlocks` records what is paid.
 */

/** Every fulfiller id tied to the same sponsorship as these. */
async function sponsorshipOf(
	fulfillerIds: string[]
): Promise<{ shortId: string; showName: boolean; ids: string[] } | null> {
	const links = await db.getFulfillerLinks(fulfillerIds);
	const shortId = links[0]?.shortId;
	if (!shortId) return null;
	const all = await db.getFulfillerLinksForSponsors([shortId]);
	return {
		shortId,
		showName: all.some((l) => l.showName),
		ids: all.map((l) => l.fulfillerId),
	};
}

/**
 * Pay whatever reward blocks these sends have earned and not yet been paid.
 * Does nothing for a fulfiller who has not linked a sponsorship; their sends
 * still count once they do.
 */
export async function creditFulfiller(fulfillerId: string, now = new Date()): Promise<void> {
	const sponsorship = await sponsorshipOf([fulfillerId]);
	if (!sponsorship) return;
	const sends = await db.listContentRequestSendsBy(sponsorship.ids);
	const blocks = blocksFor(countCreditedSends(sends));
	const earned = await db.getSponsorEarned(sponsorship.shortId);
	const paid = earned?.creditedBlocks ?? 0;
	if (blocks <= paid) return;
	await db.paySponsorEarned(
		sponsorship.shortId,
		earned ? paid : null,
		blocks,
		extendEarned(earned?.earnedUntil ?? null, blocks - paid, now)
	);
}

export interface FulfillerStats {
	/** Every send, the ones that do not count toward the reward included. */
	sends: number;
	thanked: number;
	/** Sends that count toward the reward. */
	credited: number;
	sendsPerBlock: number;
	daysPerBlock: number;
	linked: boolean;
	showName: boolean;
	earnedUntil: string | null;
}

/** What the board tells a fulfiller about their own sends and reward. */
export async function fulfillerStats(fulfillerIds: string[]): Promise<FulfillerStats> {
	const sponsorship = await sponsorshipOf(fulfillerIds);
	const ids = sponsorship ? [...new Set([...fulfillerIds, ...sponsorship.ids])] : fulfillerIds;
	const sends = await db.listContentRequestSendsBy(ids);
	const earned = sponsorship ? await db.getSponsorEarned(sponsorship.shortId) : null;
	return {
		sends: sends.length,
		thanked: sends.filter((s) => s.thankedAt).length,
		credited: countCreditedSends(sends),
		sendsPerBlock: SENDS_PER_BLOCK,
		daysPerBlock: DAYS_PER_BLOCK,
		linked: sponsorship !== null,
		showName: sponsorship?.showName ?? false,
		earnedUntil:
			earned && earned.earnedUntil > new Date() ? earned.earnedUntil.toISOString() : null,
	};
}

export interface LeaderboardEntry {
	/** GitHub name, only for a fulfiller who opted in. */
	name: string | null;
	sends: number;
}

/** How many fulfiller ids are read before merging, enough to fill the top ten. */
const LEADERBOARD_SCAN = 100;
const LEADERBOARD_SIZE = 10;

/**
 * Top fulfillers since `since` (all time when null). Ids linked to one
 * sponsorship are one person and are added together; nobody is ever named
 * without having opted in, and the ids themselves never leave the server.
 */
export async function leaderboard(since: Date | null): Promise<LeaderboardEntry[]> {
	const counts = await db.countContentRequestSendsByFulfiller(since, LEADERBOARD_SCAN);
	const links = await db.getFulfillerLinks(counts.map((c) => c.fulfillerId));
	const linkOf = new Map(links.map((l) => [l.fulfillerId, l]));

	const people = new Map<string, { sends: number; shortId: string | null; showName: boolean }>();
	for (const { fulfillerId, sends } of counts) {
		const link = linkOf.get(fulfillerId);
		const key = link ? `s:${link.shortId}` : `f:${fulfillerId}`;
		const person = people.get(key) ?? {
			sends: 0,
			shortId: link?.shortId ?? null,
			showName: false,
		};
		person.sends += sends;
		person.showName ||= link?.showName ?? false;
		people.set(key, person);
	}

	const top = [...people.values()].sort((a, b) => b.sends - a.sends).slice(0, LEADERBOARD_SIZE);
	const named = top.filter((p) => p.showName && p.shortId).map((p) => p.shortId as string);
	const names = await db.getSponsorGithubNames(named);
	return top.map((p) => ({
		name: p.showName && p.shortId ? (names.get(p.shortId) ?? null) : null,
		sends: p.sends,
	}));
}
