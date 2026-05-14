import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import { handleSelectFilesInRd } from './addMagnet';

export const getInstantIntent = async (
	rdKey: string,
	hash: string,
	fileId: number,
	ipAddress: string,
	os: string,
	player: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		const id = await addHashAsMagnet(rdKey, hash, false);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, false);
			const torrentInfo = await getTorrentInfo(rdKey, id, false);
			if (torrentInfo.status !== 'downloaded') {
				await deleteTorrent(rdKey, id, false);
				return {
					error: `Torrent status is '${torrentInfo.status}', expected 'downloaded'`,
				};
			}

			const fileIdx = torrentInfo.files
				.filter((f) => f.selected)
				.findIndex((f) => f.id === fileId);
			const link = torrentInfo.links[fileIdx] ?? torrentInfo.links[0];
			const resp = await unrestrictLink(rdKey, link, ipAddress, false);
			await deleteTorrent(rdKey, id, false);
			let intent: string;
			if (os === 'android') {
				intent = `intent://${resp.download.replace(
					'https://',
					''
				)}#Intent;type=video/any;scheme=https${
					player !== 'chooser' ? ';package=' + player : ''
				};end`;
			} else if (os === 'ios') {
				intent = `${player}://${resp.download.replace('https://', '')}`;
			} else if (os === 'ios2') {
				intent = `${player}://x-callback-url/open?url=${resp.download}`;
			} else if (os === 'mac') {
				intent = `${player}://${resp.download.replace('https://', '')}`;
			} else if (os === 'mac2') {
				intent = `${player}://weblink?url=${resp.download}`;
			} else if (os === 'mac3') {
				intent = `${player}://weblink?url=${resp.download}&new_window=1`;
			} else if (os === 'mac4') {
				intent = `${player}://x-callback-url/open?url=${resp.download}`;
			} else if (os === 'windows') {
				intent = `${player}://${resp.download}`;
			} else {
				intent = 'https://real-debrid.com/streaming-' + resp.id;
			}
			return { intent };
		} catch (e: any) {
			await deleteTorrent(rdKey, id, false).catch(() => {});
			return { error: `Failed to process torrent: ${e.message || e}` };
		}
	} catch (e: any) {
		return { error: `Failed to add magnet: ${e.message || e}` };
	}
};

export const getIntent = async (
	rdKey: string,
	link: string,
	ipAddress: string,
	os: string,
	player: string
): Promise<{ intent?: string; error?: string }> => {
	try {
		const resp = await unrestrictLink(rdKey, link, ipAddress, false);
		let intent: string;
		if (os === 'android') {
			intent = `intent://${resp.download.replace(
				'https://',
				''
			)}#Intent;type=video/any;scheme=https${
				player !== 'chooser' ? ';package=' + player : ''
			};end`;
		} else if (os === 'ios') {
			intent = `${player}://${resp.download.replace('https://', '')}`;
		} else if (os === 'ios2') {
			intent = `${player}://x-callback-url/open?url=${resp.download}`;
		} else if (os === 'mac') {
			intent = `${player}://${resp.download.replace('https://', '')}`;
		} else if (os === 'mac2') {
			intent = `${player}://weblink?url=${resp.download}`;
		} else if (os === 'mac3') {
			intent = `${player}://weblink?url=${resp.download}&new_window=1`;
		} else if (os === 'mac4') {
			intent = `${player}://x-callback-url/open?url=${resp.download}`;
		} else if (os === 'windows') {
			intent = `${player}://${resp.download}`;
		} else {
			intent = 'https://real-debrid.com/streaming-' + resp.id;
		}
		return { intent };
	} catch (e: any) {
		return { error: `Failed to unrestrict link: ${e.message || e}` };
	}
};
