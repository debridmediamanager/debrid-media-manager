import legacyWorkerSnapshot from '@/test/fixtures/torrentSnapshot/legacy-worker-0.10.0.json';
import filmPass from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-matrix-film-pass.json';
import introductionPass from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-matrix-introduction-pass.json';
import wholePass from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-matrix-whole-pass.json';
import { describe, expect, it } from 'vitest';
import {
	mergeStoredSnapshot,
	publicMediaInfo,
	TorrentSnapshot,
	toStoredSnapshot,
} from './torrentSnapshot';

// The three posts zurg's own analysis pass and sender (zurg f3bbeaa9) made for
// The Matrix (1999) 2160p Tigole, the two-file release of Fizzy card 247, as it
// sits in zen's library with the probes DMM stored for it. One pass probed the
// film while the introduction waited out an earlier failed probe, the next
// probed the introduction while the film's probe failed, and the one after
// probed both. Only the account's links, torrent id and Plex key are
// placeholders.
const FILM = 'The Matrix (1999) (2160p BluRay x265 10bit HDR Tigole).mkv';
const INTRODUCTION = 'Written Introduction by The Wachowskis.mkv';

const stored = (post: unknown) => toStoredSnapshot(TorrentSnapshot.parse(post));

describe('mergeStoredSnapshot', () => {
	it('each partial post carries one file of the two', () => {
		expect(Object.keys(stored(filmPass).SelectedFiles)).toEqual([FILM]);
		expect(Object.keys(stored(introductionPass).SelectedFiles)).toEqual([INTRODUCTION]);
		expect(Object.keys(stored(wholePass).SelectedFiles).sort()).toEqual([FILM, INTRODUCTION]);
	});

	it('stores from two partial passes what the whole pass stores', () => {
		const { snapshot, kept } = mergeStoredSnapshot(stored(filmPass), stored(introductionPass));

		expect(snapshot).toEqual(stored(wholePass));
		expect(kept).toBe(1);
	});

	it('keeps the film through a pass after a whole one that probed only the introduction', () => {
		const { snapshot, kept } = mergeStoredSnapshot(stored(wholePass), stored(introductionPass));

		expect(snapshot).toEqual(stored(wholePass));
		expect(publicMediaInfo(snapshot)).toEqual(publicMediaInfo(stored(wholePass)));
		expect(kept).toBe(1);
	});

	it("takes the post's probe of a file over the stored one", () => {
		const newer = stored(filmPass);
		const probe = newer.SelectedFiles[FILM].MediaInfo as Record<string, any>;
		probe.format = { ...probe.format, probe_score: 99 };

		const { snapshot, kept } = mergeStoredSnapshot(stored(wholePass), newer);

		const film = snapshot.SelectedFiles[FILM].MediaInfo as Record<string, any>;
		expect(film.format.probe_score).toBe(99);
		expect(snapshot.SelectedFiles[INTRODUCTION]).toEqual(
			stored(wholePass).SelectedFiles[INTRODUCTION]
		);
		expect(kept).toBe(1);
	});

	it('drops a stored entry of the same file zurg has since keyed differently', () => {
		const before = stored(wholePass);
		const rekeyed = {
			...before,
			SelectedFiles: {
				'Featurettes - Written Introduction by The Wachowskis.mkv':
					before.SelectedFiles[INTRODUCTION],
				[FILM]: before.SelectedFiles[FILM],
			},
		};

		const { snapshot, kept } = mergeStoredSnapshot(rekeyed, stored(introductionPass));

		expect(Object.keys(snapshot.SelectedFiles).sort()).toEqual([FILM, INTRODUCTION]);
		expect(kept).toBe(1);
	});

	it('passes on no link or download address from a row stored before the allowlist', () => {
		// zurgtorrent-worker's posts were stored whole, links and all.
		const legacy = structuredClone(legacyWorkerSnapshot) as Record<string, any>;
		const [key] = Object.keys(legacy.SelectedFiles);

		const { snapshot, kept } = mergeStoredSnapshot(legacy, stored(filmPass));

		expect(kept).toBe(1);
		expect(Object.keys(snapshot.SelectedFiles[key]).sort()).toEqual([
			'MediaInfo',
			'bytes',
			'path',
		]);
		expect(snapshot.SelectedFiles[key].MediaInfo).toEqual(
			publicMediaInfo(legacy)!.SelectedFiles[key].MediaInfo
		);
		const text = JSON.stringify(snapshot);
		expect(text).not.toContain('real-debrid.com');
	});

	it.each([
		['no row', null],
		['a row with no files', { Name: 'x' }],
		['a file with no probe', { SelectedFiles: { [INTRODUCTION]: { path: '/x', bytes: 1 } } }],
		[
			'a file with no path',
			{ SelectedFiles: { other: { bytes: 1, MediaInfo: { streams: [] } } } },
		],
	])('takes the post as it is over %s', (_, row) => {
		expect(mergeStoredSnapshot(row, stored(filmPass), row)).toEqual({
			snapshot: stored(filmPass),
			kept: 0,
			borrowed: 0,
		});
	});

	// Readers take a hash's newest row. A row another account posted on another
	// day holds probes of the same content.
	describe('with the newest other row of the release', () => {
		it("fills a new row's missing files from it", () => {
			// The insert creates the row from the post, so the row is the post.
			const { snapshot, kept, borrowed } = mergeStoredSnapshot(
				stored(introductionPass),
				stored(introductionPass),
				stored(wholePass)
			);

			expect(snapshot).toEqual(stored(wholePass));
			expect([kept, borrowed]).toEqual([0, 1]);
		});

		it("takes the row's own probe of a file over the other row's", () => {
			const row = stored(filmPass);
			const probe = row.SelectedFiles[FILM].MediaInfo as Record<string, any>;
			probe.format = { ...probe.format, probe_score: 99 };

			const { snapshot, kept, borrowed } = mergeStoredSnapshot(
				row,
				stored(introductionPass),
				stored(wholePass)
			);

			const film = snapshot.SelectedFiles[FILM].MediaInfo as Record<string, any>;
			expect(film.format.probe_score).toBe(99);
			expect([kept, borrowed]).toEqual([1, 0]);
		});

		it("takes the post's probe of a file over the other row's", () => {
			const newer = stored(introductionPass);
			const probe = newer.SelectedFiles[INTRODUCTION].MediaInfo as Record<string, any>;
			probe.format = { ...probe.format, probe_score: 99 };

			const { snapshot, borrowed } = mergeStoredSnapshot(newer, newer, stored(wholePass));

			const introduction = snapshot.SelectedFiles[INTRODUCTION].MediaInfo as Record<
				string,
				any
			>;
			expect(introduction.format.probe_score).toBe(99);
			expect(borrowed).toBe(1);
		});
	});
});
