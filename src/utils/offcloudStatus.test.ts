import { UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it } from 'vitest';
import { getOffcloudStatusText, getOffcloudUserTorrentStatus } from './offcloudStatus';

describe('getOffcloudStatusText', () => {
	it('maps every status in the enum', () => {
		expect(getOffcloudStatusText('created')).toBe('Queued');
		expect(getOffcloudStatusText('queued')).toBe('Queued');
		expect(getOffcloudStatusText('downloading')).toBe('Downloading');
		expect(getOffcloudStatusText('downloaded')).toBe('Finished');
		expect(getOffcloudStatusText('error')).toBe('Error');
	});

	it("spells Offcloud's `canceled` the way the rest of the UI does", () => {
		expect(getOffcloudStatusText('canceled')).toBe('Cancelled');
	});

	it('passes an unknown status through rather than blanking the cell', () => {
		expect(getOffcloudStatusText('something_new')).toBe('something_new');
		expect(getOffcloudStatusText('')).toBe('');
	});
});

describe('getOffcloudUserTorrentStatus', () => {
	it('treats `created` as queued, because that is what it is', () => {
		expect(getOffcloudUserTorrentStatus('created')).toEqual([UserTorrentStatus.waiting, 0]);
		expect(getOffcloudUserTorrentStatus('queued')).toEqual([UserTorrentStatus.waiting, 0]);
	});

	it('finishes only on `downloaded`', () => {
		expect(getOffcloudUserTorrentStatus('downloaded')).toEqual([
			UserTorrentStatus.finished,
			100,
		]);
		expect(getOffcloudUserTorrentStatus('downloading')).toEqual([
			UserTorrentStatus.downloading,
			0,
		]);
	});

	it('sends dead states to the error branch', () => {
		expect(getOffcloudUserTorrentStatus('error')).toEqual([UserTorrentStatus.error, 0]);
		expect(getOffcloudUserTorrentStatus('canceled')).toEqual([UserTorrentStatus.error, 0]);
		expect(getOffcloudUserTorrentStatus('')).toEqual([UserTorrentStatus.error, 0]);
	});
});
