import fixture from '@/test/fixtures/realdebrid/rd-add-account-pause-2026-10-05.json';
import { AxiosError, AxiosHeaders } from 'axios';

/**
 * Real-Debrid's answers to `addMagnet`, replayed from the adds recorded on a
 * test account 2026-10-04/05 (`rd-add-account-pause-2026-10-05.json`).
 *
 * Two kinds of 451 are in there, and the recording is what tells them apart:
 *
 * - **An account pause**: a run of 451s that takes in a hash the account had
 *   just accepted (a warm, control or probe add), or two or more 451s in a
 *   row. Every add from the first 451 of the run until the next 201 is
 *   refused, whatever it was.
 * - **A refused release**: a lone 451 outside any pause, right after which the
 *   account accepted a known-good control, on a hash the recording never shows
 *   accepted. That hash is refused at any time.
 *
 * Everything else is accepted: the recording shows each of those hashes
 * accepted, or refused only during a pause. `recordedAnswer` reproduces every
 * answer in the recording at the instant it was recorded.
 */

export type RecordedAdd = { at: string; role: string; hash: string; status: number };
export type SequenceName = keyof typeof fixture.sequences;

export const RD_REFUSAL = fixture.refusal;
export const sequence = (name: SequenceName): RecordedAdd[] => fixture.sequences[name].adds;
export const ms = (iso: string) => Date.parse(iso);

const KNOWN_GOOD_ROLES = new Set(['warm', 'control', 'probe', 'precheck']);

export type PauseWindow = { from: number; until: number };

/** Every pause the recording shows: [first 451 of the run, next 201). */
export const pauseWindows = (): PauseWindow[] => {
	const windows: PauseWindow[] = [];
	for (const name of Object.keys(fixture.sequences) as SequenceName[]) {
		const adds = sequence(name);
		let run: RecordedAdd[] = [];
		for (const add of adds) {
			if (add.status === 451) {
				run.push(add);
				continue;
			}
			if (run.length > 1 || run.some((r) => KNOWN_GOOD_ROLES.has(r.role))) {
				windows.push({ from: ms(run[0].at), until: ms(add.at) });
			}
			run = [];
		}
	}
	return windows;
};

/** Hashes refused outside any pause and never accepted: RD refusing the release. */
export const refusedReleases = (): Set<string> => {
	const windows = pauseWindows();
	const inPause = (t: number) => windows.some((w) => t >= w.from && t < w.until);
	const all = (Object.keys(fixture.sequences) as SequenceName[]).flatMap((name) =>
		sequence(name)
	);
	const accepted = new Set(all.filter((add) => add.status === 201).map((add) => add.hash));
	return new Set(
		all
			.filter((add) => add.status === 451 && !inPause(ms(add.at)) && !accepted.has(add.hash))
			.map((add) => add.hash)
	);
};

/** What the recorded account answers an add of `hash` at time `now`. */
export const recordedAnswer = (hash: string, now: number): 201 | 451 => {
	const h = hash.toLowerCase();
	if (pauseWindows().some((w) => now >= w.from && now < w.until)) return 451;
	return refusedReleases().has(h) ? 451 : 201;
};

/** The axios error a 451 from RD throws, body as recorded. */
export const rdRefusalError = () =>
	new AxiosError('Request failed with status code 451', 'ERR_BAD_REQUEST', undefined, undefined, {
		status: RD_REFUSAL.status,
		statusText: '',
		headers: {},
		config: { headers: new AxiosHeaders() },
		data: { ...RD_REFUSAL.body },
	});
