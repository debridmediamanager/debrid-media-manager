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
 * hold the account's other adds for a while, try the same add once more, and
 * only then say RD refused it, as something to retry later rather than as a
 * fact about the release.
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

/** Shown while an interactive add waits to be tried again. */
export const RD_ADD_PAUSE_RETRY_MESSAGE = `Real-Debrid is pausing adds on your account. Trying again in ${
	RD_ADD_PAUSE_MS / 1000
} seconds...`;

/** Shown when the second try was refused as well. */
export const RD_ADD_REFUSED_MESSAGE =
	'Real-Debrid refused this release. If other releases get refused too, wait a few minutes and try again.';

/** Shown when an add has to wait for a pause another add ran into. */
export const rdAddWaitMessage = (waitMs: number) =>
	`Real-Debrid is pausing adds on your account. This add will go through in ${Math.max(
		1,
		Math.ceil(waitMs / 1000)
	)} seconds.`;

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
 * An add RD refused twice, a pause apart. Temporary by construction: it says
 * RD did not take the add now, not that it never will.
 */
export class RdAddPausedError extends Error {
	readonly temporary = true;
	/** The second refusal, as RD sent it. */
	readonly refusal: unknown;

	constructor(refusal?: unknown) {
		super(RD_ADD_REFUSED_MESSAGE);
		this.name = 'RdAddPausedError';
		this.refusal = refusal;
	}
}

/**
 * Runs an RD add, and once more if RD answers it with a 451.
 *
 * The wait is not here: `addHashAsMagnet` and `addTorrentFile` record the
 * pause on the account and hold every later add on it, this second try
 * included, until the pause is over. `onPause` runs before that wait, so a
 * caller with a user watching can say what is happening.
 *
 * A second 451 becomes `RdAddPausedError`, a temporary failure.
 */
export async function retryRdAddThroughPause<T>(
	add: () => Promise<T>,
	onPause?: () => void
): Promise<T> {
	try {
		return await add();
	} catch (error) {
		if (!isRdAddRefusal(error)) throw error;
		onPause?.();
	}
	try {
		return await add();
	} catch (error) {
		if (isRdAddRefusal(error)) throw new RdAddPausedError(error);
		throw error;
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
