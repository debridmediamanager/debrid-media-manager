import {
	DMM_SOURCE,
	SearchSourceStates,
	formatSourceLabel,
	initSourceStates,
	markSourceResults,
	markSourceStatus,
} from '@/utils/searchSources';
import { describe, expect, it } from 'vitest';

describe('formatSourceLabel', () => {
	it('gives each known source its display name', () => {
		expect(formatSourceLabel(DMM_SOURCE)).toBe('DMM');
		expect(formatSourceLabel('torrentio')).toBe('Torrentio');
		expect(formatSourceLabel('comet')).toBe('Comet');
		expect(formatSourceLabel('mediafusion')).toBe('MediaFusion');
		expect(formatSourceLabel('peerflix')).toBe('Peerflix');
		expect(formatSourceLabel('torrentsdb')).toBe('TorrentsDB');
	});

	it('marks the Tor-routed variants', () => {
		expect(formatSourceLabel('mediafusion-tor')).toBe('MediaFusion (Tor)');
		expect(formatSourceLabel('torrentio-tor')).toBe('Torrentio (Tor)');
	});

	it('falls back to the raw slug for a source it does not know', () => {
		expect(formatSourceLabel('newaddon')).toBe('newaddon');
		expect(formatSourceLabel('newaddon-tor')).toBe('newaddon (Tor)');
	});
});

describe('initSourceStates', () => {
	it('always includes DMM and lists it first', () => {
		const states = initSourceStates(['torrentio', 'comet']);
		expect(Object.keys(states)).toEqual([DMM_SOURCE, 'torrentio', 'comet']);
		expect(Object.values(states).every((s) => s.status === 'loading' && s.count === 0)).toBe(
			true
		);
	});

	it('is DMM alone when no external sources run', () => {
		expect(Object.keys(initSourceStates([]))).toEqual([DMM_SOURCE]);
	});
});

describe('state transitions', () => {
	const base: SearchSourceStates = initSourceStates(['torrentio']);

	it('accumulates counts across the batches a source streams in', () => {
		let states = markSourceResults(base, 'torrentio', 3);
		states = markSourceResults(states, 'torrentio', 2);
		expect(states.torrentio).toEqual({ status: 'loading', count: 5 });
	});

	it('keeps the count when a source finishes', () => {
		let states = markSourceResults(base, 'torrentio', 4);
		states = markSourceStatus(states, 'torrentio', 'done');
		expect(states.torrentio).toEqual({ status: 'done', count: 4 });
	});

	it('records failures separately from empty results', () => {
		const failed = markSourceStatus(base, 'torrentio', 'error');
		expect(failed.torrentio).toEqual({ status: 'error', count: 0 });
		const empty = markSourceStatus(base, 'torrentio', 'done');
		expect(empty.torrentio).toEqual({ status: 'done', count: 0 });
	});

	it('ignores sources that are not being tracked', () => {
		expect(markSourceResults(base, 'unknown', 5)).toBe(base);
		expect(markSourceStatus(base, 'unknown', 'done')).toBe(base);
	});

	it('does not mutate the previous state', () => {
		const next = markSourceResults(base, 'torrentio', 1);
		expect(base.torrentio.count).toBe(0);
		expect(next).not.toBe(base);
	});
});
