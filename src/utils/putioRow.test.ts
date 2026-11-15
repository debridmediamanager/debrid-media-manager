import { PUTIO_TRANSFER_STATUSES } from '@/services/putio';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it } from 'vitest';
import {
	getPutioStatusText,
	getPutioUserTorrentStatus,
	parsePutioDate,
	parsePutioRowId,
	toPutioRowId,
} from './putioRow';

describe('put.io transfer status', () => {
	const expected: Record<string, UserTorrentStatus> = {
		WAITING: UserTorrentStatus.waiting,
		PREPARING_DOWNLOAD: UserTorrentStatus.waiting,
		IN_QUEUE: UserTorrentStatus.waiting,
		WAITING_FOR_DOWNLOADER: UserTorrentStatus.waiting,
		DOWNLOADING: UserTorrentStatus.downloading,
		WAITING_FOR_COMPLETE_QUEUE: UserTorrentStatus.downloading,
		COMPLETING: UserTorrentStatus.downloading,
		STOPPING: UserTorrentStatus.finished,
		SEEDING: UserTorrentStatus.finished,
		PREPARING_SEED: UserTorrentStatus.finished,
		COMPLETED: UserTorrentStatus.finished,
		ERROR: UserTorrentStatus.error,
	};

	it('maps every status the SDK defines, and nothing is left to the fallback', () => {
		expect(Object.keys(expected).sort()).toEqual([...PUTIO_TRANSFER_STATUSES].sort());
		for (const status of PUTIO_TRANSFER_STATUSES) {
			expect(getPutioUserTorrentStatus(status, 40)[0]).toBe(expected[status]);
			expect(getPutioStatusText(status)).not.toBe(status);
		}
	});

	it('reports finished rows at 100 and clamps live progress', () => {
		expect(getPutioUserTorrentStatus('SEEDING', 12)).toEqual([UserTorrentStatus.finished, 100]);
		expect(getPutioUserTorrentStatus('DOWNLOADING', 140)).toEqual([
			UserTorrentStatus.downloading,
			100,
		]);
		expect(getPutioUserTorrentStatus('IN_QUEUE', null)).toEqual([UserTorrentStatus.waiting, 0]);
	});

	it('shows a status put.io adds later as itself, as an error until mapped', () => {
		expect(getPutioUserTorrentStatus('NEW_THING', 50)).toEqual([UserTorrentStatus.error, 50]);
		expect(getPutioStatusText('NEW_THING')).toBe('NEW_THING');
		expect(getPutioStatusText(null)).toBe('Unknown');
		// Not a prototype key either.
		expect(getPutioStatusText('toString')).toBe('toString');
	});
});

describe('put.io row ids', () => {
	it('round-trips a transfer id and refuses anything else', () => {
		expect(parsePutioRowId(toPutioRowId(9001))).toBe(9001);
		for (const bad of ['pt:', 'pt:0', 'pt:-1', 'pt:12a', 'oc:12', '12']) {
			expect(parsePutioRowId(bad)).toBeNull();
		}
	});
});

describe('parsePutioDate', () => {
	it('reads a zoneless put.io time as UTC', () => {
		expect(parsePutioDate('2026-11-15T03:28:42.708815')?.toISOString()).toBe(
			'2026-11-15T03:28:42.708Z'
		);
		expect(parsePutioDate('2026-11-15T03:28:42Z')?.toISOString()).toBe(
			'2026-11-15T03:28:42.000Z'
		);
		expect(parsePutioDate('nonsense')).toBeNull();
		expect(parsePutioDate(null)).toBeNull();
	});
});
