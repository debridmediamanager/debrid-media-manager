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
	fileId: string,
	ipAddress: string,
	os: string,
	player: string
) => {
	let intent = '';
	try {
		const id = await addHashAsMagnet(rdKey, hash, true);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, true);
			const torrent = await getTorrentInfo(rdKey, id, true);
			let link = '';

			if (!fileId) {
				// get biggest file index
				const biggestFile = torrent.files.reduce((prev, current) => {
					return prev.bytes > current.bytes ? prev : current;
				});
				const biggestFileIdx = torrent.files.findIndex((f) => f.id === biggestFile.id);
				link = torrent.links[biggestFileIdx] ?? torrent.links[0];
			} else {
				const fileIdx = torrent.files
					.filter((f) => f.selected)
					.findIndex((f) => f.id === fileId);
				link = torrent.links[fileIdx] ?? torrent.links[0];
			}

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
			} else if (os === 'mac') {
				intent = `${player}://${resp.download.replace('https://', '')}`;
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
		} else if (os === 'mac') {
			intent = `${player}://${resp.download.replace('https://', '')}`;
		} else {
			intent = 'https://real-debrid.com/streaming-' + resp.id;
		}
	} catch (e) {
		console.log(e);
	}
	return intent;
};
