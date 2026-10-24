/**
 * What a fulfiller earns, kept away from Prisma and HTTP.
 *
 * Fulfilling spends the fulfiller's own TorBox quota on somebody else's
 * library, so the reward is the thing DMM would otherwise charge for: sponsor
 * time. Every `SENDS_PER_BLOCK` counted sends buy `DAYS_PER_BLOCK` days.
 */

export const SENDS_PER_BLOCK = 10;
export const DAYS_PER_BLOCK = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SendRow {
	requesterId: string;
	fulfilledAt: Date | string | null;
}

/**
 * Sends that count toward the reward: at most one per asker per UTC day.
 *
 * Without the limit a fulfiller with a second Real-Debrid account could file
 * and fulfil their own asks all day. With it, farming takes a fresh premium
 * Real-Debrid account per send per day, while somebody working the board
 * loses nothing: two sends to one stranger on one day is rare.
 */
export function countCreditedSends(rows: SendRow[]): number {
	const seen = new Set<string>();
	for (const row of rows) {
		if (!row.fulfilledAt) continue;
		const day = new Date(row.fulfilledAt).toISOString().slice(0, 10);
		seen.add(`${row.requesterId}|${day}`);
	}
	return seen.size;
}

export function blocksFor(creditedSends: number): number {
	return Math.floor(creditedSends / SENDS_PER_BLOCK);
}

/**
 * When earned time runs out after `newBlocks` more are paid. Time stacks on
 * what is left rather than restarting today, so nothing already earned is lost.
 */
export function extendEarned(current: Date | null, newBlocks: number, now: Date): Date {
	const base = current && current > now ? current : now;
	return new Date(base.getTime() + newBlocks * DAYS_PER_BLOCK * DAY_MS);
}
