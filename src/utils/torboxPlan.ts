// A free TorBox account cannot source a transfer. Its `checkcached` answers
// normally, so the uploader gets as far as `createtorrent` before TorBox refuses
// with `403 PLAN_RESTRICTED_FEATURE` - and TorBox is the only cache source, so
// the job fails with nothing left to try. Nineteen jobs ended that way between
// 2026-08-08 and 2026-09-23. Asking `/user/me` first turns that into a refusal
// the user sees at submission, before a job is queued.

const USER_ME_URL = 'https://api.torbox.app/v1/api/user/me';
const TIMEOUT_MS = 5000;

/** TorBox's `plan` field: 0 Free, 1 Essential, 2 Standard, 3 Pro. */
const FREE_PLAN = 0;

export const FREE_TORBOX_PLAN_MESSAGE =
	'Your TorBox account is on the free plan, which has no API access. Transfers need a paid TorBox plan.';

/**
 * Whether this TorBox key belongs to a free account.
 *
 * Only a definite answer refuses: `plan: 0`, or `/user/me` itself refusing with
 * `PLAN_RESTRICTED_FEATURE`. Anything else - a timeout, a 429, a bad key, a body
 * that does not parse - returns false and lets the job through, where the
 * uploader reports what actually went wrong. The check exists to save a doomed
 * job, never to become a second way for a paid account's transfer to fail.
 *
 * Deliberately a bare fetch rather than `services/torbox`: that client waits
 * out a 429 for up to five minutes, which would hang a submission, and records
 * every response on the public status page, where a free account's 403 would
 * read as a TorBox fault.
 */
export async function isFreeTorBoxPlan(apiKey: string): Promise<boolean> {
	try {
		const res = await fetch(USER_ME_URL, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = await res.json().catch(() => null);
		if (res.status === 403) return body?.error === 'PLAN_RESTRICTED_FEATURE';
		if (!res.ok || body?.success !== true) return false;
		return body?.data?.plan === FREE_PLAN;
	} catch {
		return false;
	}
}
