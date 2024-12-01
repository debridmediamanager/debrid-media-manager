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
) => {
	let intent = '';
	try {
		const id = await addHashAsMagnet(rdKey, hash, true);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, true);
			const torrentInfo = await getTorrentInfo(rdKey, id, true);
			if (torrentInfo.status !== 'downloaded') {
				throw new Error('Torrent not downloaded');
			}

			const fileIdx = torrentInfo.files
				.filter((f) => f.selected)
				.findIndex((f) => f.id === fileId);
			const link = torrentInfo.links[fileIdx] ?? torrentInfo.links[0];
			const resp = await unrestrictLink(rdKey, link, ipAddress, true);
			await deleteTorrent(rdKey, id, true);
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
			} else {
				intent = 'https://real-debrid.com/streaming-' + resp.id;
			}
		} catch (e) {
			await deleteTorrent(rdKey, id, true);
		}
	} catch (e) {
		console.log(e);
	}
	return intent;
};

export const getIntent = async (
	rdKey: string,
	link: string,
	ipAddress: string,
	os: string,
	player: string
) => {
	let intent = '';
	try {
		const resp = await unrestrictLink(rdKey, link, ipAddress, true);
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
		} else {
			intent = 'https://real-debrid.com/streaming-' + resp.id;
		}
	} catch (e) {
		console.log(e);
	}
	return intent;
};
