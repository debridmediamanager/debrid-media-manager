import { UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it } from 'vitest';
import {
	DL_ERROR_STATUS,
	getDebridLinkServiceStatus,
	getDebridLinkStatusText,
	getDebridLinkUserTorrentStatus,
} from './debridLinkStatus';

describe('getDebridLinkStatusText', () => {
	it('maps every documented enum member', () => {
		expect(getDebridLinkStatusText('0')).toBe('Paused');
		expect(getDebridLinkStatusText('1')).toBe('Queued');
		expect(getDebridLinkStatusText('2')).toBe('Verifying');
		expect(getDebridLinkStatusText('4')).toBe('Downloading');
		expect(getDebridLinkStatusText('8')).toBe('Seeding');
		expect(getDebridLinkStatusText('100')).toBe('Finished');
	});

	// The whole reason the mapping is a threshold and a flag test rather than an
	// equality ladder: the vendor's own documentation sample carries `status: 6`,
	// which is VERIFICATION|DOWNLOADING and equals no single enum member.
	it('reads a combined flag as the most advanced state it carries', () => {
		expect(getDebridLinkStatusText('6')).toBe('Downloading');
		expect(getDebridLinkStatusText('3')).toBe('Verifying');
		expect(getDebridLinkStatusText('12')).toBe('Seeding');
	});

	// `>= 100`, never `=== 100`.
	it('finishes above the threshold, not only at it', () => {
		expect(getDebridLinkStatusText('101')).toBe('Finished');
		expect(getDebridLinkStatusText('255')).toBe('Finished');
	});

	it('names an undocumented flag rather than inventing a label', () => {
		expect(getDebridLinkStatusText('16')).toBe('Status 16');
	});

	it('shows the vendor error text as it was written', () => {
		expect(getDebridLinkStatusText(DL_ERROR_STATUS)).toBe('Error');
		expect(getDebridLinkStatusText('Torrent file is invalid')).toBe('Torrent file is invalid');
		expect(getDebridLinkStatusText('')).toBe('');
	});
});

describe('getDebridLinkServiceStatus', () => {
	it('stores the raw number for a healthy torrent', () => {
		expect(getDebridLinkServiceStatus({ status: 6, error: 0, errorString: '' })).toBe('6');
		expect(getDebridLinkServiceStatus({ status: 100 })).toBe('100');
	});

	it("prefers the vendor's own message when the torrent carries one", () => {
		expect(getDebridLinkServiceStatus({ status: 4, error: 12, errorString: 'disk full' })).toBe(
			'disk full'
		);
	});

	it('falls back to a bare error marker when the code has no message', () => {
		expect(getDebridLinkServiceStatus({ status: 4, error: 12, errorString: '  ' })).toBe(
			DL_ERROR_STATUS
		);
		expect(getDebridLinkServiceStatus({ status: 4, error: 12 })).toBe(DL_ERROR_STATUS);
	});
});

describe('getDebridLinkUserTorrentStatus', () => {
	it('finishes at and above the threshold', () => {
		expect(getDebridLinkUserTorrentStatus({ status: 100, downloadPercent: 100 })).toEqual([
			UserTorrentStatus.finished,
			100,
		]);
		expect(getDebridLinkUserTorrentStatus({ status: 101, downloadPercent: 12 })).toEqual([
			UserTorrentStatus.finished,
			100,
		]);
	});

	// Seeding sits below 100 but can only ever seed content it already holds.
	it('treats seeding as finished', () => {
		expect(getDebridLinkUserTorrentStatus({ status: 8, downloadPercent: 100 })).toEqual([
			UserTorrentStatus.finished,
			100,
		]);
	});

	it('keeps the percentage while a combined flag is transferring', () => {
		expect(getDebridLinkUserTorrentStatus({ status: 6, downloadPercent: 41 })).toEqual([
			UserTorrentStatus.downloading,
			41,
		]);
		expect(getDebridLinkUserTorrentStatus({ status: 2, downloadPercent: 3 })).toEqual([
			UserTorrentStatus.downloading,
			3,
		]);
	});

	it('waits on queued and paused alike', () => {
		expect(getDebridLinkUserTorrentStatus({ status: 1 })).toEqual([
			UserTorrentStatus.waiting,
			0,
		]);
		expect(getDebridLinkUserTorrentStatus({ status: 0 })).toEqual([
			UserTorrentStatus.waiting,
			0,
		]);
	});

	// An errored torrent can be mid-flag and still be dead, so the error field
	// wins over whatever the status says.
	it('reports an error whatever the status flags claim', () => {
		expect(
			getDebridLinkUserTorrentStatus({ status: 100, downloadPercent: 100, error: 7 })
		).toEqual([UserTorrentStatus.error, 100]);
		expect(
			getDebridLinkUserTorrentStatus({ status: 4, downloadPercent: 9, errorString: 'dead' })
		).toEqual([UserTorrentStatus.error, 9]);
	});

	// `downloaded` is the webapp's "user has fetched this" flag, not completion.
	it('never reads completion off anything but downloadPercent', () => {
		expect(
			getDebridLinkUserTorrentStatus({
				status: 4,
				downloadPercent: 0,
				...({ downloaded: true } as Record<string, unknown>),
			})
		).toEqual([UserTorrentStatus.downloading, 0]);
	});
});
