import { describe, expect, it } from 'vitest';
import type { DebridUploaderJobStatus } from './debridUploader';
import type { Nzb2rdJobStatus } from './nzb2rd';
import {
	describeTransfer,
	PHASE_LABELS,
	PHASE_STYLES,
	phaseLabelOf,
	queueDetail,
	rdPercentFromMessage,
	TOTAL_STEPS,
} from './transferPhase';

// Every member of each service's union, listed so the compiler fails here when a
// service ships a new stage: the page would otherwise render it as `Unknown`.
const DEBRID_STATUSES: DebridUploaderJobStatus[] = [
	'pending',
	'downloading',
	'preparing',
	'uploading',
	'completed',
	'failed',
];

const NZB2RD_STATUSES: Nzb2rdJobStatus[] = [
	'pending',
	'probing',
	'hashing',
	'fetching',
	'unpacking',
	'preparing',
	'uploading',
	'completed',
	'failed',
];

describe('describeTransfer — every status is mapped', () => {
	it('never leaves a debrid status unknown', () => {
		for (const status of DEBRID_STATUSES) {
			expect(describeTransfer('debrid', { status }).phase).not.toBe('unknown');
		}
	});

	it('never leaves an nzb2rd status unknown', () => {
		for (const status of NZB2RD_STATUSES) {
			expect(describeTransfer('nzb2rd', { status }).phase).not.toBe('unknown');
		}
	});

	it('gives every phase a label and a chip style', () => {
		for (const source of ['debrid', 'nzb2rd'] as const) {
			const statuses = source === 'debrid' ? DEBRID_STATUSES : NZB2RD_STATUSES;
			for (const status of statuses) {
				const { phase, label } = describeTransfer(source, { status });
				expect(label).toBe(PHASE_LABELS[phase]);
				expect(PHASE_STYLES[phase]).toBeTruthy();
			}
		}
	});

	it('degrades an unrecognised status rather than throwing', () => {
		const p = describeTransfer('nzb2rd', { status: 'repairing' });
		expect(p.phase).toBe('unknown');
		expect(p.percent).toBeNull();
		expect(p.step).toBeNull();
	});

	it('handles a job that has not been polled yet', () => {
		expect(describeTransfer('debrid', undefined).phase).toBe('unknown');
	});
});

describe('the aligned vocabulary', () => {
	it('calls pending "Queued" on both sources', () => {
		expect(phaseLabelOf('debrid', 'pending')).toBe('Queued');
		expect(phaseLabelOf('nzb2rd', 'pending')).toBe('Queued');
	});

	// The whole point of the mapping: `uploading` means RD pulling *from* us, so
	// showing the raw word tells the user the opposite of what is happening.
	it('reports uploading as Real-Debrid downloading on both sources', () => {
		expect(phaseLabelOf('debrid', 'uploading')).toBe('Real-Debrid downloading');
		expect(phaseLabelOf('nzb2rd', 'uploading')).toBe('Real-Debrid downloading');
	});

	// debrid's `downloading` moves no payload bytes — it probes the cache and
	// builds the torrent — so it must not be shown as a download.
	it('does not call the debrid downloading stage a download', () => {
		expect(phaseLabelOf('debrid', 'downloading')).toBe('Preparing torrent');
	});

	// `hashing` (streamed) and `fetching` (staged) are the same thing to a user.
	it('shows both Usenet routes as one Downloading phase', () => {
		const hashing = describeTransfer('nzb2rd', { status: 'hashing' });
		const fetching = describeTransfer('nzb2rd', { status: 'fetching' });
		expect(hashing.phase).toBe('downloading');
		expect(fetching.phase).toBe('downloading');
		expect(hashing.step).toBe(fetching.step);
	});
});

describe('step counting', () => {
	it('advances monotonically along each ladder', () => {
		for (const source of ['debrid', 'nzb2rd'] as const) {
			const statuses = source === 'debrid' ? DEBRID_STATUSES : NZB2RD_STATUSES;
			let previous = 0;
			for (const status of statuses) {
				const { step } = describeTransfer(source, { status });
				if (step === null) continue;
				expect(step).toBeGreaterThanOrEqual(previous);
				previous = step;
			}
		}
	});

	it('keeps the total stable across the staged and streamed routes', () => {
		// `unpacking` only happens on the staged fallback, so it shares a step
		// with the download rather than making the ladder longer.
		const streamed = describeTransfer('nzb2rd', { status: 'hashing' });
		const staged = describeTransfer('nzb2rd', { status: 'unpacking' });
		expect(streamed.step).toBe(3);
		expect(staged.step).toBe(3);
		expect(streamed.totalSteps).toBe(staged.totalSteps);
		expect(streamed.totalSteps).toBe(TOTAL_STEPS.nzb2rd);
	});

	it('drops the step once terminal', () => {
		expect(describeTransfer('debrid', { status: 'completed' }).step).toBeNull();
		expect(describeTransfer('debrid', { status: 'failed' }).step).toBeNull();
	});
});

describe('percent', () => {
	it('never goes backwards as a job walks its ladder', () => {
		for (const source of ['debrid', 'nzb2rd'] as const) {
			const statuses = source === 'debrid' ? DEBRID_STATUSES : NZB2RD_STATUSES;
			let previous = -1;
			for (const status of statuses) {
				if (status === 'failed') continue;
				const { percent } = describeTransfer(source, { status });
				expect(percent).not.toBeNull();
				expect(percent as number).toBeGreaterThanOrEqual(previous);
				previous = percent as number;
			}
		}
	});

	it('is 100 when completed and absent when failed', () => {
		expect(describeTransfer('nzb2rd', { status: 'completed' }).percent).toBe(100);
		expect(describeTransfer('nzb2rd', { status: 'failed' }).percent).toBeNull();
	});

	it('advances within the Usenet download using the byte counters', () => {
		const start = describeTransfer('nzb2rd', {
			status: 'hashing',
			total_bytes: 1000,
			done_bytes: 0,
		});
		const half = describeTransfer('nzb2rd', {
			status: 'hashing',
			total_bytes: 1000,
			done_bytes: 500,
		});
		const done = describeTransfer('nzb2rd', {
			status: 'hashing',
			total_bytes: 1000,
			done_bytes: 1000,
		});
		expect(start.percent).toBe(8);
		expect(half.percent).toBe(28);
		expect(done.percent).toBe(48);
	});

	it('advances within RD’s pull using the percentage RD reports', () => {
		const quarter = describeTransfer('debrid', {
			status: 'uploading',
			status_message: 'RD: downloading 25% @ 11.6 MB/s',
		});
		// 25 → 100 is the debrid rung, so RD at 25% sits a quarter along it.
		expect(quarter.percent).toBe(44);

		const usenet = describeTransfer('nzb2rd', {
			status: 'uploading',
			status_message: 'RD: downloading 50% @ 8.0 MB/s',
		});
		expect(usenet.percent).toBe(79);
	});

	it('sits at the stage floor when nothing finer is reported', () => {
		expect(describeTransfer('debrid', { status: 'uploading' }).percent).toBe(25);
		expect(describeTransfer('nzb2rd', { status: 'hashing' }).percent).toBe(8);
	});

	it('ignores byte counters outside the download stage', () => {
		// `preparing` leaves done_bytes at the total; reading it as a fraction
		// there would show the handoff stage as already finished.
		const p = describeTransfer('nzb2rd', {
			status: 'preparing',
			total_bytes: 1000,
			done_bytes: 1000,
		});
		expect(p.percent).toBe(52);
	});
});

describe('rdPercentFromMessage', () => {
	it('reads the format both services emit', () => {
		expect(rdPercentFromMessage('RD: downloading 42% @ 11.6 MB/s')).toBe(42);
		expect(rdPercentFromMessage('RD: uploading 100% @ 0.0 MB/s')).toBe(100);
		expect(rdPercentFromMessage('RD: queued 0.5% @ 0.0 MB/s')).toBe(0.5);
	});

	it('refuses a percentage that is not RD progress', () => {
		expect(rdPercentFromMessage('Fetching articles 30% done')).toBeNull();
		expect(rdPercentFromMessage('RD: downloading')).toBeNull();
		expect(rdPercentFromMessage(null)).toBeNull();
		expect(rdPercentFromMessage(undefined)).toBeNull();
	});

	it('clamps a nonsense figure into range', () => {
		expect(rdPercentFromMessage('RD: downloading 140% @ 1.0 MB/s')).toBe(100);
	});
});

describe('queueDetail', () => {
	it('words the front of the line plainly', () => {
		expect(queueDetail({ position: 1, waiting: 1 })).toBe('next in line');
		expect(queueDetail({ position: 1, waiting: 9 })).toBe('next in line');
	});

	it('gives the place and the depth, so the wait is legible', () => {
		expect(queueDetail({ position: 2, waiting: 7 })).toBe('2nd of 7 in line');
		expect(queueDetail({ position: 3, waiting: 7 })).toBe('3rd of 7 in line');
		expect(queueDetail({ position: 4, waiting: 7 })).toBe('4th of 7 in line');
	});

	it('gets the teens right', () => {
		expect(queueDetail({ position: 11, waiting: 30 })).toBe('11th of 30 in line');
		expect(queueDetail({ position: 12, waiting: 30 })).toBe('12th of 30 in line');
		expect(queueDetail({ position: 13, waiting: 30 })).toBe('13th of 30 in line');
		expect(queueDetail({ position: 21, waiting: 30 })).toBe('21st of 30 in line');
		expect(queueDetail({ position: 22, waiting: 30 })).toBe('22nd of 30 in line');
		expect(queueDetail({ position: 23, waiting: 30 })).toBe('23rd of 30 in line');
	});

	it('says nothing when there is no place to report', () => {
		expect(queueDetail(undefined)).toBeUndefined();
		expect(queueDetail(null)).toBeUndefined();
		expect(queueDetail({ position: 0, waiting: 3 })).toBeUndefined();
		expect(queueDetail({ position: 1, waiting: 0 })).toBeUndefined();
	});
});

describe('a queued job’s place in line', () => {
	it('is shown on both sources', () => {
		for (const source of ['debrid', 'nzb2rd'] as const) {
			const p = describeTransfer(source, {
				status: 'pending',
				queue: { position: 3, waiting: 7 },
			});
			expect(p.label).toBe('Queued');
			expect(p.detail).toBe('3rd of 7 in line');
		}
	});

	// The services omit `queue` once a job starts, and older builds never send
	// it at all — neither may break the row.
	it('is simply absent when the service does not report one', () => {
		expect(describeTransfer('nzb2rd', { status: 'pending' }).detail).toBeUndefined();
		expect(describeTransfer('nzb2rd', { status: 'hashing' }).detail).toBeUndefined();
	});

	it('creeps the bar forward as the job advances up the line', () => {
		const back = describeTransfer('nzb2rd', {
			status: 'pending',
			queue: { position: 10, waiting: 10 },
		});
		const middle = describeTransfer('nzb2rd', {
			status: 'pending',
			queue: { position: 5, waiting: 10 },
		});
		const front = describeTransfer('nzb2rd', {
			status: 'pending',
			queue: { position: 1, waiting: 10 },
		});

		expect(back.percent).toBe(0);
		expect(middle.percent).toBeGreaterThan(back.percent as number);
		expect(front.percent).toBeGreaterThan(middle.percent as number);
		// Still inside the queued rung — waiting is not progress through the work.
		expect(front.percent).toBeLessThanOrEqual(2);
	});

	it('treats a queue of one as being at the front', () => {
		const p = describeTransfer('debrid', {
			status: 'pending',
			queue: { position: 1, waiting: 1 },
		});
		expect(p.percent).toBe(3);
	});

	it('never leaves the queued rung on a nonsense place', () => {
		const p = describeTransfer('nzb2rd', {
			status: 'pending',
			queue: { position: 99, waiting: 3 },
		});
		expect(p.percent).toBe(0);
	});
});
