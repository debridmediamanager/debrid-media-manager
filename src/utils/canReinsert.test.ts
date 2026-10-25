import { describe, expect, it } from 'vitest';

import type { MagnetStatus } from '@/services/allDebrid';
import type { UserTorrent } from '@/torrent/userTorrent';
import fixture from '../test/fixtures/alldebrid-library-magnet.json';
import tbFixture from '../test/fixtures/torbox-reannounce-finished.json';
import { canReinsert } from './canReinsert';

const row = (id: string, adData?: Partial<MagnetStatus>) =>
	({ id, adData: adData as MagnetStatus }) as UserTorrent;
const tbRow = (over: object = {}) =>
	({
		id: `tb:${tbFixture.torrent.id}`,
		tbData: { ...tbFixture.torrent, ...over },
	}) as unknown as UserTorrent;

describe('canReinsert', () => {
	it('offers Real-Debrid torrents', () => {
		expect(canReinsert(row('rd:ABC'))).toBe(true);
	});

	// TorBox answered the reannounce of this cached torrent with 500
	// DOWNLOAD_SERVER_ERROR, as it did every finished torrent on the account.
	it('offers a TorBox torrent only while it is active', () => {
		expect(tbFixture.reannounce.detail).toBe('DOWNLOAD_SERVER_ERROR');
		expect(canReinsert(tbRow())).toBe(false);
		expect(
			canReinsert(
				tbRow({ active: true, download_finished: false, download_state: 'downloading' })
			)
		).toBe(true);
	});

	// AllDebrid's restart refuses anything that has not failed (MAGNET_PROCESSING).
	it('offers an AllDebrid magnet only once it has failed', () => {
		expect(canReinsert(row('ad:813291548', fixture.listStatusMagnet))).toBe(false);
		expect(
			canReinsert(
				row('ad:813291548', {
					...fixture.listStatusMagnet,
					status: 'No peer after 30 minutes',
					statusCode: 7,
				})
			)
		).toBe(true);
	});

	// These have no reinsert operation; the row button used to do nothing.
	it('never offers Premiumize, Offcloud or Debrid-Link torrents', () => {
		expect(canReinsert(row('pm:tNwjm2iDZBrmew324IRGIwA'))).toBe(false);
		expect(canReinsert(row('oc:bUk9yEUGbyeBokKgW9wyBA'))).toBe(false);
		expect(canReinsert(row('dl:s1p7g8e3g1olpl44s8ocwn1p'))).toBe(false);
	});
});
