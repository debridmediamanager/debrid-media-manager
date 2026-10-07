import { rdLongRefusal, type RdLongRefusal } from '@/services/rdAddOutcomes';

/**
 * Real-Debrid's `451 infringing_file` on an add, read as what it usually is.
 *
 * RD answers `POST /torrents/addMagnet` (and `addTorrent`) with
 * `451 {"error": "infringing_file", "error_code": 35}` in two situations that
 * look identical: it refuses that release, or it is refusing every add on the
 * account for a while. Measured on a test account 2026-10-04/05
 * (src/test/fixtures/realdebrid/rd-add-account-pause-2026-10-05.json): during
 * such a pause every add was refused, Big Buck Bunny and hashes the account had
 * accepted minutes earlier included; pauses lasted 21 s to about 5 minutes; and
 * E.T., refused twice that evening, was accepted at 01:00:23. Adding hashes new
 * to the account tripped a pause after anywhere from 2 to 9 adds, so no count
 * predicts one. Only a name RD blocks (`isRdBlockedName`) was refused every
 * time.
 *
 * So a 451 on a name RD is not known to block is not a verdict on the release:
 * hold the account's other adds for a while, try the same add again (once,
 * or for up to five minutes when a user is watching it), and only then say
 * RD refused it, as the account's state rather than a fact about the release.
 */

/**
 * How long one 451 holds the account's adds before the same add is tried
 * again. Long enough to outlast the shortest pauses measured (21 s, three times
 * over) without making a user wait out the five-minute ones in front of a
 * spinner.
 */
export const RD_ADD_PAUSE_MS = 30_000;

/**
 * How long a bulk run keeps going while every add is refused. The longest
 * pause measured was about five minutes; past six, RD is not pausing in the way
 * it was seen to, and the rest of the run is better left for later.
 */
export const RD_ADD_PAUSE_GIVE_UP_MS = 6 * 60_000;

/**
 * How long an add someone is watching holds the account's adds before each
 * further try: 30 s, then 90 s, then 3 minutes, five minutes in all. One try
 * after 30 s covered only the shortest pauses measured; the others (82 s,
 * 183 s, about five minutes) outlasted it, and the user was told RD refused
 * the release while RD was still refusing everything on the account.
 */
export const RD_ADD_INTERACTIVE_HOLDS_MS: readonly number[] = [30_000, 90_000, 180_000];

/** "30 seconds", "90 seconds", "3 minutes". */
export const formatRdAddWait = (ms: number): string => {
	const seconds = Math.max(1, Math.ceil(ms / 1000));
	if (seconds < 120) return `${seconds} second${seconds === 1 ? '' : 's'}`;
	return `${Math.round(seconds / 60)} minutes`;
};

/** "40 minutes", "2 hours", "12 hours". */
const formatRefusalSpan = (ms: number): string => {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
	return `${Math.round(minutes / 60)} hours`;
};

/** What RD has done to this account's adds, said with its own numbers. */
const describeLongRefusal = ({ refused, tries, forMs }: RdLongRefusal) =>
	`Real-Debrid has refused ${refused} of the last ${tries} adds on your account over ${formatRefusalSpan(
		forMs
	)}`;

/**
 * Shown while an interactive add waits `holdMs` to be tried again. When RD has
 * been refusing the account for longer than a pause (`rdLongRefusal`), says so
 * rather than promising a short wait.
 */
export const rdAddPauseRetryMessage = (
	holdMs: number = RD_ADD_PAUSE_MS,
	longRefusal: RdLongRefusal | null = null
) =>
	longRefusal
		? `${describeLongRefusal(longRefusal)}. Trying again in ${formatRdAddWait(holdMs)}...`
		: `Real-Debrid is pausing adds on your account. Trying again in ${formatRdAddWait(holdMs)}...`;

/**
 * Shown when every try was refused, `waitedMs` of holds apart. Says what it
 * most likely is: the account, which other apps on the same key also add to.
 * When the refusals have lasted far longer than any pause measured, waiting a
 * few minutes is no advice: send the user to RD, which can tell a blocked
 * account from a busy one where DMM cannot.
 */
export const rdAddRefusedMessage = (
	waitedMs: number = RD_ADD_PAUSE_MS,
	longRefusal: RdLongRefusal | null = null
) =>
	longRefusal
		? `${describeLongRefusal(longRefusal)}, which is longer than a short pause. Try adding any torrent on real-debrid.com: if it is refused there too, the block is on your Real-Debrid account and Real-Debrid support is who can lift it. If it goes through there, check what else adds on this account (zurg, Sonarr, Radarr).`
		: `Real-Debrid is still refusing adds on your account after ${formatRdAddWait(
				waitedMs
			)}, so this is most likely not about this release. Adds from other apps on this Real-Debrid account (zurg, Sonarr, Radarr) count too. Try again in a few minutes.`;

/** Shown when an add has to wait for a pause another add ran into. */
export const rdAddWaitMessage = (waitMs: number) =>
	`Real-Debrid is pausing adds on your account. This add will go through in ${formatRdAddWait(
		waitMs
	)}.`;

type RefusalShape = {
	response?: { status?: unknown; data?: { error?: unknown; error_code?: unknown } | null };
};

/**
 * Whether a failed RD add is its 451 `infringing_file` (error code 35): the
 * status, or the error name if a proxy changed the status on the way.
 */
export function isRdAddRefusal(error: unknown): boolean {
	const response = (error as RefusalShape | null)?.response;
	if (!response) return false;
	return response.status === 451 || response.data?.error === 'infringing_file';
}

/**
 * An add RD refused on every try, holds apart. Temporary by construction: it
 * says RD did not take the add now, not that it never will.
 */
export class RdAddPausedError extends Error {
	readonly temporary = true;
	/** The last refusal, as RD sent it. */
	readonly refusal: unknown;

	constructor(
		refusal?: unknown,
		waitedMs: number = RD_ADD_PAUSE_MS,
		longRefusal: RdLongRefusal | null = null
	) {
		super(rdAddRefusedMessage(waitedMs, longRefusal));
		this.name = 'RdAddPausedError';
		this.refusal = refusal;
	}
}

export type RdPauseRetryOptions = {
	/**
	 * The hold before each further try. The default, one 30 s hold, suits a
	 * caller that cannot keep someone waiting for minutes (a Stremio request, a
	 * bulk run); `RD_ADD_INTERACTIVE_HOLDS_MS` suits one a user is watching.
	 */
	holdsMs?: readonly number[];
	/**
	 * Runs on each 451 that earns another try, before the hold. A hold longer
	 * than `RD_ADD_PAUSE_MS` is the caller's to put on the account
	 * (`recordRdAddPause`), as is telling the user.
	 */
	onPause?: (holdMs: number) => void;
	/**
	 * The token the add is sent with, so the final refusal can say how long RD
	 * has been refusing this account (`rdLongRefusal`).
	 */
	token?: string;
};

/**
 * Runs an RD add, and again after each hold while RD answers it with a 451.
 *
 * The wait is not here: `addHashAsMagnet` and `addTorrentFile` record the
 * pause on the account and hold every later add on it, these tries included,
 * until the pause is over.
 *
 * A 451 on the last try becomes `RdAddPausedError`, a temporary failure.
 */
export async function retryRdAddThroughPause<T>(
	add: () => Promise<T>,
	{ holdsMs = [RD_ADD_PAUSE_MS], onPause, token }: RdPauseRetryOptions = {}
): Promise<T> {
	let waitedMs = 0;
	for (let attempt = 0; ; attempt++) {
		try {
			return await add();
		} catch (error) {
			if (!isRdAddRefusal(error)) throw error;
			if (attempt >= holdsMs.length)
				throw new RdAddPausedError(error, waitedMs, token ? rdLongRefusal(token) : null);
			onPause?.(holdsMs[attempt]);
			waitedMs += holdsMs[attempt];
		}
	}
}

export type BulkRdAddOutcome = 'added' | 'failed' | 'paused';

/**
 * One add of a bulk run, with the second try a paused add is owed.
 *
 * `add` is handed a callback to call when RD answered with a 451 it could not
 * explain by the name. The retry needs no delay of its own: the account's
 * pause holds it until RD has had `RD_ADD_PAUSE_MS` of quiet.
 */
export async function addThroughRdPause(
	add: (onPaused: () => void) => Promise<boolean>
): Promise<BulkRdAddOutcome> {
	let paused = false;
	const onPaused = () => {
		paused = true;
	};
	if (await add(onPaused)) return 'added';
	if (!paused) return 'failed';
	paused = false;
	if (await add(onPaused)) return 'added';
	return paused ? 'paused' : 'failed';
}

/**
 * How long a bulk run has met nothing but paused adds. A run stops once that
 * outlasts `RD_ADD_PAUSE_GIVE_UP_MS`, instead of after a fixed number of 451s.
 */
export class RdPauseStreak {
	private since: number | null = null;

	note(outcome: BulkRdAddOutcome): void {
		if (outcome !== 'paused') {
			this.since = null;
			return;
		}
		this.since ??= Date.now();
	}

	get exhausted(): boolean {
		return this.since !== null && Date.now() - this.since >= RD_ADD_PAUSE_GIVE_UP_MS;
	}
}
