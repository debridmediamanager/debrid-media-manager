import { toast } from 'react-hot-toast';

// One user-facing vocabulary for both transfer kinds.
//
// The two services name their stages after their own internals, and the words
// do not line up: `debrid`'s `downloading` moves no payload bytes at all (it
// probes the cache, creates the provider torrent and registers the webseed —
// the bytes only move later, when RD pulls through the proxy), while nzb2rd's
// `hashing`/`fetching` is the stage that genuinely drags the whole release over
// the wire. And on both, `uploading` means *Real-Debrid downloading from us*,
// which reads backwards to anyone watching their own transfer.
//
// So the enums are mapped here rather than renamed: they are pinned by SQLite
// CHECK constraints, resume-on-boot and nzb2rd's SABnzbd mapping, and a rename
// would strand rows already in flight. nzb2rd's `sabStatusOf` already does this
// same translation for Radarr/Sonarr; this is the same idea for the Transfers
// page.

export type TransferSource = 'debrid' | 'nzb2rd';

/**
 * How long a settled transfer toast stays up. Every send flow reaches a final
 * wording rather than holding a spinner for the length of an RD download, so
 * the toast has to clear itself — otherwise a page left open collects one stuck
 * notification per transfer.
 */
export const TRANSFER_TOAST_MS = 8000;

/** How long an unsettled step's toast lingers if the poll loop stops feeding it. */
export const TRANSFER_STEP_TOAST_MS = 30000;

/** How the toast on a transfer names its source, in one `X → RD` shape. */
export const TRANSFER_LABELS = {
	tb: 'TB → RD',
	// No `ad`: AllDebrid is withdrawn as a transfer source. `ORIGIN_LABELS` in
	// `transfers.ts` still names it, because jobs it already served are on the
	// Transfers page and have to be labelled correctly.
	usenet: 'Usenet → RD',
	/** The library page's send button, which doesn't know its source yet. */
	send: 'Send to RD',
} as const;

/**
 * Where every transfer ends, whatever supplied the bytes. Once a job reaches
 * `uploading`, Real-Debrid is pulling them and nothing after that needs the
 * browser — so a TorBox, AllDebrid and Usenet transfer all say this and then
 * get out of the way.
 */
export function toastRdUnderway(label: string, toastId?: string): void {
	toast.success(`${label}: Real-Debrid download underway — follow it on the Transfers page.`, {
		id: toastId,
		duration: TRANSFER_TOAST_MS,
	});
}

export type TransferPhase =
	| 'queued'
	| 'checking'
	| 'downloading'
	| 'extracting'
	| 'preparing'
	| 'handoff'
	| 'importing'
	| 'completed'
	| 'failed'
	| 'unknown';

export const PHASE_LABELS: Record<TransferPhase, string> = {
	queued: 'Queued',
	checking: 'Checking release',
	downloading: 'Downloading',
	extracting: 'Extracting',
	preparing: 'Preparing torrent',
	handoff: 'Sending to Real-Debrid',
	// `uploading` on both services means RD is pulling the bytes *from us*, so
	// from the user's side this is Real-Debrid doing the downloading.
	importing: 'Real-Debrid downloading',
	completed: 'Done',
	failed: 'Failed',
	unknown: 'Unknown',
};

export const PHASE_STYLES: Record<TransferPhase, string> = {
	queued: 'border-gray-500 bg-gray-900/30 text-gray-100',
	checking: 'border-cyan-500 bg-cyan-900/30 text-cyan-100',
	downloading: 'border-blue-500 bg-blue-900/30 text-blue-100',
	extracting: 'border-amber-500 bg-amber-900/30 text-amber-100',
	preparing: 'border-amber-500 bg-amber-900/30 text-amber-100',
	handoff: 'border-violet-500 bg-violet-900/30 text-violet-100',
	importing: 'border-purple-500 bg-purple-900/30 text-purple-100',
	completed: 'border-green-500 bg-green-900/30 text-green-100',
	failed: 'border-red-500 bg-red-900/30 text-red-100',
	unknown: 'border-gray-500 bg-gray-900/30 text-gray-400',
};

/**
 * One rung of a source's ladder. `from`/`to` are the share of the overall bar
 * this rung owns, weighted by measured wall clock rather than spread evenly:
 * on a Usenet job the Usenet pass and RD's pull are ~70-80s and ~107-128s of a
 * ~230s job, and on a TB → RD job everything before RD's pull is seconds.
 *
 * Two rungs may share a `step`: nzb2rd's `unpacking` only happens on the staged
 * fallback, so counting it as its own step would make the total change route by
 * route ("step 3 of 5" becoming "step 4 of 6" mid-transfer).
 */
interface Rung {
	statuses: readonly string[];
	phase: TransferPhase;
	step: number;
	from: number;
	to: number;
}

const LADDERS: Record<TransferSource, readonly Rung[]> = {
	debrid: [
		{ statuses: ['pending'], phase: 'queued', step: 1, from: 0, to: 3 },
		// Not a download: cache probe, provider torrent, rewritten .torrent.
		{ statuses: ['downloading'], phase: 'preparing', step: 2, from: 3, to: 15 },
		{ statuses: ['preparing'], phase: 'handoff', step: 3, from: 15, to: 25 },
		{ statuses: ['uploading'], phase: 'importing', step: 4, from: 25, to: 100 },
	],
	nzb2rd: [
		{ statuses: ['pending'], phase: 'queued', step: 1, from: 0, to: 2 },
		{ statuses: ['probing'], phase: 'checking', step: 2, from: 2, to: 8 },
		// `hashing` (streamed, the default) and `fetching` (staged fallback) are
		// the same thing to a user: the release coming off Usenet.
		{ statuses: ['hashing', 'fetching'], phase: 'downloading', step: 3, from: 8, to: 48 },
		{ statuses: ['unpacking'], phase: 'extracting', step: 3, from: 48, to: 52 },
		{ statuses: ['preparing'], phase: 'handoff', step: 4, from: 52, to: 58 },
		{ statuses: ['uploading'], phase: 'importing', step: 5, from: 58, to: 100 },
	],
};

export const TOTAL_STEPS: Record<TransferSource, number> = {
	debrid: 4,
	nzb2rd: 5,
};

/**
 * A waiting job's place in line, as both services report it. Present only
 * while the job is still queued, so its absence is not "position unknown" —
 * it means the job is no longer waiting.
 */
export interface QueuePlace {
	position: number;
	waiting: number;
}

/** The job fields progress can be read from, whichever service produced them. */
export interface ProgressFields {
	status?: string;
	status_message?: string | null;
	total_bytes?: number | null;
	done_bytes?: number | null;
	queue?: QueuePlace | null;
}

/**
 * Real-Debrid's own percentage, which both services format identically into
 * `status_message` while RD pulls: `RD: downloading 42% @ 11.6 MB/s`. This is
 * the only progress signal `debrid` produces at all, and it covers the phase
 * that is most of a TB → RD job's wall clock.
 *
 * The `RD:` prefix is required so an unrelated message carrying a percentage
 * cannot be read as RD progress.
 */
export function rdPercentFromMessage(message: string | null | undefined): number | null {
	if (!message || !message.startsWith('RD:')) return null;
	const match = /\s(\d+(?:\.\d+)?)%/.exec(message);
	if (!match) return null;
	return Math.min(Math.max(parseFloat(match[1]), 0), 100);
}

/**
 * How far through its own rung the job is, 0-1. Only two rungs can answer:
 * nzb2rd counts bytes through the Usenet pass, and both services report RD's
 * percentage while it pulls. Everywhere else the bar sits at the rung's floor
 * and moves when the stage does — which is honest, since nothing finer exists.
 */
function fractionWithin(rung: Rung, job: ProgressFields): number {
	if (rung.phase === 'importing') {
		const rd = rdPercentFromMessage(job.status_message);
		return rd === null ? 0 : rd / 100;
	}
	if (rung.phase === 'downloading') {
		const total = job.total_bytes ?? 0;
		const done = job.done_bytes ?? 0;
		if (total <= 0) return 0;
		return Math.min(done / total, 1);
	}
	if (rung.phase === 'queued' && job.queue) {
		// Advancing up the line is the only progress a queued job makes, so the
		// bar creeps across the (deliberately narrow) queued rung as it does.
		const { position, waiting } = job.queue;
		if (waiting <= 1) return 1;
		return Math.min(Math.max((waiting - position) / (waiting - 1), 0), 1);
	}
	return 0;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. */
function ordinal(n: number): string {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
}

/**
 * How the wait is worded. "Next in line" beats "1st of 1 in line", and the
 * total is what tells someone whether their place is good news or bad.
 */
export function queueDetail(place: QueuePlace | null | undefined): string | undefined {
	if (!place || place.position < 1 || place.waiting < 1) return undefined;
	if (place.position === 1) return 'next in line';
	return `${ordinal(place.position)} of ${place.waiting} in line`;
}

export interface TransferProgress {
	phase: TransferPhase;
	/** What to show the user; never a raw service enum. */
	label: string;
	/** Extra wording for the phase, e.g. the place in line while queued. */
	detail?: string;
	/** 1-based position on this source's ladder, or null once terminal. */
	step: number | null;
	totalSteps: number;
	/** 0-100, or null when there is nothing meaningful to draw. */
	percent: number | null;
	terminal: boolean;
}

/**
 * Translate a job into the shared vocabulary, with a step count and a bar.
 * `job` is undefined until the first poll lands, and an unrecognised status
 * (a service shipping a new stage before DMM knows about it) degrades to
 * `unknown` rather than throwing.
 */
export function describeTransfer(
	source: TransferSource,
	job: ProgressFields | undefined
): TransferProgress {
	const totalSteps = TOTAL_STEPS[source];
	const status = job?.status;

	if (status === 'completed') {
		return {
			phase: 'completed',
			label: PHASE_LABELS.completed,
			step: null,
			totalSteps,
			percent: 100,
			terminal: true,
		};
	}
	if (status === 'failed') {
		return {
			phase: 'failed',
			label: PHASE_LABELS.failed,
			step: null,
			totalSteps,
			percent: null,
			terminal: true,
		};
	}

	const rung = LADDERS[source].find((r) => r.statuses.includes(status ?? ''));
	if (!rung) {
		return {
			phase: 'unknown',
			label: PHASE_LABELS.unknown,
			step: null,
			totalSteps,
			percent: null,
			terminal: false,
		};
	}

	const span = rung.to - rung.from;
	return {
		phase: rung.phase,
		label: PHASE_LABELS[rung.phase],
		detail: rung.phase === 'queued' ? queueDetail(job?.queue) : undefined,
		step: rung.step,
		totalSteps,
		percent: Math.round(rung.from + span * fractionWithin(rung, job ?? {})),
		terminal: false,
	};
}

/** The friendly label alone, for toasts that used to print the raw enum. */
export function phaseLabelOf(source: TransferSource, status: string | undefined): string {
	return describeTransfer(source, { status }).label;
}
