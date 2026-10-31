/**
 * The wanted list only works through a zurg reading it, and a sponsor who
 * pressed Want with no zurg set up gets nothing and is told nothing. On
 * 2026-10-31, 37 sponsors' lists (3,214 titles) had sat a day and more with no
 * zurg ever reading them, and two more had stopped being read days before.
 * After a day of that the site says so, with the guide that sets it up.
 */
export const WANTED_UNREAD_AFTER_MS = 24 * 60 * 60 * 1000;

export const WANTED_GUIDE_URL = 'https://notes.debridmediamanager.com/zurg/guides/dmm-wanted/';

export interface WantedSummary {
	count: number;
	/** When the oldest title on the list was added. */
	since: string | null;
	/** When a zurg last read the list. */
	lastPolledAt: string | null;
}

export type WantedUnread = { never: true } | { never: false; lastPolledAt: string };

/**
 * Whether the list has gone unread long enough to warn about: it has held
 * titles for a day and no zurg has read it in the last day. `never` says no zurg
 * ever has, which is a setup to do rather than one that broke.
 */
export function wantedUnread(summary: WantedSummary, now = Date.now()): WantedUnread | null {
	if (summary.count < 1 || !summary.since) return null;
	if (now - Date.parse(summary.since) < WANTED_UNREAD_AFTER_MS) return null;
	if (!summary.lastPolledAt) return { never: true };
	if (now - Date.parse(summary.lastPolledAt) < WANTED_UNREAD_AFTER_MS) return null;
	return { never: false, lastPolledAt: summary.lastPolledAt };
}
