/**
 * What Real-Debrid answered this account's recent adds, kept long enough to
 * tell a pause from an account RD has been refusing for hours.
 *
 * The pauses measured 2026-10-04/05 lasted 21 s to about 5 minutes, and the
 * add path's wording assumes one. DMM's proxy log for 2026-10-04..07 also shows
 * two or three users a day whose adds RD refused for hours: one was refused 17
 * of 18 times from 23:19 to 11:11, the single success at 11:05 followed by a
 * refusal 13 s later (src/test/fixtures/realdebrid/rd-long-refusal-2026-10-07.json).
 * Telling them "trying again in 30 seconds" for twelve hours is wrong, so this
 * keeps the account's answers and says when they stopped looking like a pause.
 *
 * In the browser the log lives in localStorage, so it outlasts a reload and the
 * user's next visit; elsewhere (an API route) it lives in memory. It is keyed by
 * a digest of the access token, never the token itself, which also means a
 * renewed token starts a fresh log.
 */

/** A refusal run shorter than this is still read as a pause. */
export const RD_LONG_REFUSAL_MS = 30 * 60_000;
/** Fewer refusals than this is too little to call the account refused. */
const MIN_REFUSALS = 6;
/** At most one accepted add for every this many refused. */
const REFUSALS_PER_ACCEPT = 10;
const KEEP_MS = 24 * 60 * 60_000;
const MAX_OUTCOMES = 500;
const MAX_ACCOUNTS = 64;
const STORAGE_KEY = 'rd:addOutcomes';

/** [when, accepted] */
type Outcome = [number, boolean];
type Log = Record<string, Outcome[]>;

let memory: Log = {};

/** Not a secret-grade hash, only a key that does not store the token. */
function digest(token: string): string {
	let a = 0x811c9dc5;
	let b = 5381;
	for (let i = 0; i < token.length; i++) {
		const c = token.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193) >>> 0;
		b = (Math.imul(b, 33) + c) >>> 0;
	}
	return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function storage(): Storage | null {
	try {
		return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
	} catch {
		return null;
	}
}

function readLog(): Log {
	const store = storage();
	if (!store) return memory;
	try {
		const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}');
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writeLog(log: Log): void {
	const store = storage();
	if (!store) {
		memory = log;
		return;
	}
	try {
		store.setItem(STORAGE_KEY, JSON.stringify(log));
	} catch {
		// Full or blocked storage: the add itself must not fail over this.
	}
}

function recent(outcomes: Outcome[] | undefined, now: number): Outcome[] {
	return (Array.isArray(outcomes) ? outcomes : [])
		.filter((o) => Array.isArray(o) && now - o[0] <= KEEP_MS)
		.slice(-MAX_OUTCOMES);
}

/**
 * One add RD answered on this token: accepted, or refused with a 451 its name
 * does not explain. A 451 on a name RD blocks says nothing about the account
 * and is not recorded.
 */
export function recordRdAddOutcome(token: string, accepted: boolean): void {
	if (!token) return;
	const now = Date.now();
	const log = readLog();
	const key = digest(token);
	const outcomes = recent(log[key], now);
	outcomes.push([now, accepted]);
	log[key] = outcomes;
	for (const other of Object.keys(log)) {
		if (other !== key && !recent(log[other], now).length) delete log[other];
	}
	const keys = Object.keys(log);
	if (keys.length > MAX_ACCOUNTS) {
		const lastSeen = (k: string) => log[k][log[k].length - 1]?.[0] ?? 0;
		keys.sort((x, y) => lastSeen(x) - lastSeen(y))
			.slice(0, keys.length - MAX_ACCOUNTS)
			.forEach((k) => delete log[k]);
	}
	writeLog(log);
}

export type RdLongRefusal = {
	/** Adds RD refused in the run. */
	refused: number;
	/** Adds in the run, accepted ones included. */
	tries: number;
	/** From the run's first add until now. */
	forMs: number;
};

/**
 * Whether RD has been refusing this account's adds for longer than a pause:
 * the longest recent run, ending now, in which nearly every add was refused
 * (at least `MIN_REFUSALS`, at most one accepted per `REFUSALS_PER_ACCEPT`),
 * once it spans `RD_LONG_REFUSAL_MS`. Null while it still looks like a pause.
 */
export function rdLongRefusal(token: string): RdLongRefusal | null {
	if (!token) return null;
	const now = Date.now();
	const outcomes = recent(readLog()[digest(token)], now);
	let refused = 0;
	let accepted = 0;
	let run: RdLongRefusal | null = null;
	for (let i = outcomes.length - 1; i >= 0; i--) {
		if (outcomes[i][1]) accepted++;
		else refused++;
		if (refused >= MIN_REFUSALS && accepted * REFUSALS_PER_ACCEPT <= refused) {
			run = { refused, tries: refused + accepted, forMs: now - outcomes[i][0] };
		}
	}
	return run && run.forMs >= RD_LONG_REFUSAL_MS ? run : null;
}

/** Test seam: forget every account's outcomes, stored and in memory. */
export function resetRdAddOutcomes(): void {
	memory = {};
	try {
		storage()?.removeItem(STORAGE_KEY);
	} catch {
		// Nothing to forget.
	}
}
