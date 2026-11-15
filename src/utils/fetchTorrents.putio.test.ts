import transfers from '@/test/fixtures/putio/transfers.json';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it } from 'vitest';
import { convertToPutioUserTorrent } from './fetchTorrents';

const all = [...transfers.list.transfers, ...transfers.continue.transfers];
const byId = (id: number) => all.find((t) => t.id === id)!;

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
