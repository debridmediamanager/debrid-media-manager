import paid from '@/test/fixtures/putio/recorded-paid-2026-11-15.json';
import transfers from '@/test/fixtures/putio/transfers.json';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it } from 'vitest';
import { convertToPutioUserTorrent } from './fetchTorrents';

const all = [...transfers.list.transfers, ...transfers.continue.transfers];
const byId = (id: number) => all.find((t) => t.id === id)!;

const BBB = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

describe('convertToPutioUserTorrent on recorded transfers', () => {
	// The add answers with the magnet as its name and no hash, size or files.
	it('never titles a fresh add with its magnet, and takes the hash from its source', () => {
		const row = convertToPutioUserTorrent(paid['transfers-add-known'].body.transfer);
		expect(row.hash).toBe(BBB);
		expect(row.filename).toBe(BBB);
		expect(row.filename).not.toMatch(/^magnet:/);
		expect(row.title).not.toMatch(/^magnet:/);
		expect(row.status).toBe(UserTorrentStatus.waiting);
		expect(row.bytes).toBe(0);
	});

	it('reads a completed transfer as finished, with its name, size and UTC date', () => {
		const transfer = paid['transfer-completed'].body.transfer;
		const row = convertToPutioUserTorrent(transfer);
		expect(row).toMatchObject({
			filename: 'Big Buck Bunny',
			hash: BBB,
			bytes: transfer.size,
			status: UserTorrentStatus.finished,
			progress: 100,
		});
		expect(row.added.toISOString()).toBe('2026-11-15T04:01:29.000Z');
	});

	// An unknown hash is accepted and then downloads with size 0 and no peers.
	it('shows a hash put.io cannot find as downloading, not as an error', () => {
		const row = convertToPutioUserTorrent(paid['transfer-unknown-after6s'].body.transfer);
		expect(row.status).toBe(UserTorrentStatus.downloading);
		expect(row.bytes).toBe(0);
	});

	it('converts every row of the recorded pages', () => {
		const rows = [
			...paid['transfers-list-four'].body.transfers,
			...paid['transfers-list-continue'].body.transfers,
		].map((t) => convertToPutioUserTorrent(t));
		expect(rows.every((r) => /^pt:\d+$/.test(r.id) && /^[0-9a-f]{40}$/.test(r.hash))).toBe(
			true
		);
	});
});

describe('convertToPutioUserTorrent', () => {
	it('builds one pt: row per transfer with the fields DMM reads', () => {
		const seeding = all.find((t) => t.status === 'SEEDING')!;
		const row = convertToPutioUserTorrent(seeding);
		expect(row).toMatchObject({
			id: `pt:${seeding.id}`,
			filename: seeding.name,
			hash: seeding.hash,
			bytes: seeding.size,
			status: UserTorrentStatus.finished,
			progress: 100,
			serviceStatus: 'SEEDING',
			mediaType: 'tv',
			links: [],
			selectedFiles: [],
		});
		// put.io's zoneless time, read as UTC
		expect(row.added.toISOString()).toBe(`${seeding.created_at}.000Z`);
	});

	it('takes the hash from a magnet source when put.io leaves `hash` null', () => {
		expect(convertToPutioUserTorrent(byId(9013)).hash).toBe('0d'.repeat(20));
		expect(convertToPutioUserTorrent(byId(9014)).hash).toBe('');
	});

	it('survives null size, progress, speed, peers and a fractional timestamp', () => {
		const row = convertToPutioUserTorrent(byId(9015));
		expect(row).toMatchObject({ bytes: 0, progress: 0, speed: 0, seeders: 0 });
		expect(row.status).toBe(UserTorrentStatus.waiting);
		expect(Number.isNaN(row.added.getTime())).toBe(false);
	});

	it('survives a transfer with nothing but an id', () => {
		const row = convertToPutioUserTorrent({ id: 7 });
		expect(row).toMatchObject({ id: 'pt:7', filename: 'noname', hash: '', bytes: 0 });
		expect(row.status).toBe(UserTorrentStatus.error);
	});

	it('prefers the hash the caller just added with', () => {
		const hash = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
		expect(convertToPutioUserTorrent(byId(9014), hash).hash).toBe(hash);
	});
});
