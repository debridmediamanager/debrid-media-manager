import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInstantIntent, getIntent } from './intent';

const {
	addHashAsMagnetMock,
	deleteTorrentMock,
	getTorrentInfoMock,
	unrestrictLinkMock,
	handleSelectFilesInRdMock,
} = vi.hoisted(() => ({
	addHashAsMagnetMock: vi.fn(),
	deleteTorrentMock: vi.fn(),
	getTorrentInfoMock: vi.fn(),
	unrestrictLinkMock: vi.fn(),
	handleSelectFilesInRdMock: vi.fn(),
}));

vi.mock('@/services/realDebrid', () => ({
	addHashAsMagnet: addHashAsMagnetMock,
	deleteTorrent: deleteTorrentMock,
	getTorrentInfo: getTorrentInfoMock,
	unrestrictLink: unrestrictLinkMock,
}));

vi.mock('./addMagnet', () => ({
	handleSelectFilesInRd: handleSelectFilesInRdMock,
}));

describe('intent helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('builds the android intent string for downloaded torrents', async () => {
		addHashAsMagnetMock.mockResolvedValue('rd123');
		handleSelectFilesInRdMock.mockResolvedValue(undefined);
		getTorrentInfoMock.mockResolvedValue({
			status: 'downloaded',
			files: [
				{ id: 10, selected: true },
				{ id: 11, selected: true },
			],
			links: ['https://link-one', 'https://link-two'],
		});
		unrestrictLinkMock.mockResolvedValue({
			id: 'stream-id',
			download: 'https://files.domain/video.mp4',
		});
		deleteTorrentMock.mockResolvedValue(undefined);

		const intent = await getInstantIntent(
			'rd-token',
			'hash',
			11,
			'1.1.1.1',
			'android',
			'com.vlc'
		);

		expect(intent).toEqual({
			intent: 'intent://files.domain/video.mp4#Intent;type=video/any;scheme=https;package=com.vlc;end',
		});
		expect(deleteTorrentMock).toHaveBeenCalledWith('rd-token', 'rd123', false);
	});

	it('falls back to RD streaming URLs when no OS handler matches', async () => {
		addHashAsMagnetMock.mockResolvedValue('rd567');
		handleSelectFilesInRdMock.mockResolvedValue(undefined);
		getTorrentInfoMock.mockResolvedValue({
			status: 'downloaded',
			files: [{ id: 1, selected: true }],
			links: ['https://link-one'],
		});
		unrestrictLinkMock.mockResolvedValue({
			id: 'stream-xyz',
			download: 'https://files.domain/video.mp4',
		});
		deleteTorrentMock.mockResolvedValue(undefined);

		const result = await getInstantIntent('rd', 'hash', 1, 'ip', 'linux', 'player');
		expect(result).toEqual({ intent: 'https://real-debrid.com/streaming-stream-xyz' });
		expect(deleteTorrentMock).toHaveBeenCalledTimes(1);
	});

	it('cleans up torrents even when download status is not ready', async () => {
		addHashAsMagnetMock.mockResolvedValue('rd999');
		handleSelectFilesInRdMock.mockResolvedValue(undefined);
		getTorrentInfoMock.mockResolvedValue({
			status: 'downloading',
			files: [{ id: 1, selected: false }],
			links: [],
		});
		deleteTorrentMock.mockResolvedValue(undefined);

		const result = await getInstantIntent('rd', 'hash', 1, 'ip', 'android', 'chooser');

		expect(result).toEqual({
			error: "Torrent status is 'downloading', expected 'downloaded'",
		});
		expect(deleteTorrentMock).toHaveBeenCalledWith('rd', 'rd999', false);
	});

	it('builds intents directly from existing links', async () => {
		unrestrictLinkMock.mockResolvedValue({
			id: 'stream',
			download: 'https://files.domain/video.mp4',
		});

		const result = await getIntent('rd', 'https://link', 'ip', 'mac3', 'vlc');
		expect(result).toEqual({
			intent: 'vlc://weblink?url=https://files.domain/video.mp4&new_window=1',
		});
	});

	it('returns an empty string when unrestricting fails', async () => {
		unrestrictLinkMock.mockRejectedValue(new Error('rd down'));

		const result = await getIntent('rd', 'https://link', 'ip', 'android', 'chooser');
		expect(result).toEqual({ error: 'Failed to unrestrict link: rd down' });
	});

	it('builds Windows intent with player URL scheme', async () => {
		unrestrictLinkMock.mockResolvedValue({
			id: 'stream',
			download: 'https://files.domain/video.mp4',
		});

		const result = await getIntent('rd', 'https://link', 'ip', 'windows', 'vlc');
		expect(result).toEqual({ intent: 'vlc://https://files.domain/video.mp4' });
	});

	it('builds Windows intent for PotPlayer', async () => {
		unrestrictLinkMock.mockResolvedValue({
			id: 'stream',
			download: 'https://files.domain/video.mp4',
		});

		const result = await getIntent('rd', 'https://link', 'ip', 'windows', 'potplayer');
		expect(result).toEqual({ intent: 'potplayer://https://files.domain/video.mp4' });
	});
});
