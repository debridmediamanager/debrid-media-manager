import { showInfoForAD, showInfoForRD } from '@/components/showInfo';
import { getTorrentInfo } from '@/services/realDebrid';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { defaultPlayer } from '@/utils/settings';
import { filenameParse } from '@ctrl/video-filename-parser';
import { every, some } from 'lodash';
import { getRdStatus } from './fetchTorrents';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';

export async function handleShowInfoForRD2(
	t: UserTorrent,
	rdKey: string,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	torrentDB: any
) {
	const info = await getTorrentInfo(rdKey, t.id.substring(3));

	if (t.status === UserTorrentStatus.waiting || t.status === UserTorrentStatus.downloading) {
		setUserTorrentsList((prev) => {
			const newList = [...prev];
			const idx = prev.findIndex((i) => i.id === t.id);
			if (idx >= 0) {
				newList[idx].progress = info.progress;
				newList[idx].seeders = info.seeders;
				newList[idx].speed = info.speed;
				newList[idx].status = getRdStatus(info);
				newList[idx].serviceStatus = info.status;
				newList[idx].links = info.links;
				const selectedFiles = info.files.filter((f) => f.selected);
				newList[idx].selectedFiles = selectedFiles.map((f, idx) => ({
					fileId: f.id,
					filename: f.path,
					filesize: f.bytes,
					link: selectedFiles.length === info.links.length ? info.links[idx] : '',
				}));
			}
			return newList;
		});
		await torrentDB.add(t);
	}

	const filenames = info.files.map((f) => f.path);
	const torrentAndFiles = [t.filename, ...filenames];
	const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);

	if (
		t.mediaType !== 'other' &&
		(every(torrentAndFiles, (f) => !isVideo({ path: f })) ||
			(info.progress === 100 &&
				info.files.filter((f) => f.selected).length !== info.links.length &&
				info.links.length === 1))
	) {
		setUserTorrentsList((prev) => {
			const newList = [...prev];
			const idx = prev.findIndex((i) => i.id === t.id);
			if (idx >= 0) {
				newList[idx].mediaType = 'other';
				newList[idx].title = newList[idx].filename;
				newList[idx].info = undefined;
			}
			return newList;
		});
		await torrentDB.add(t);
	} else if (
		t.mediaType === 'movie' &&
		(hasEpisodes ||
			some(torrentAndFiles, (f) => /s\d\d\d?.?e\d\d\d?/i.test(f)) ||
			some(torrentAndFiles, (f) => /season.?\d+/i.test(f)) ||
			some(torrentAndFiles, (f) => /episodes?\s?\d+/i.test(f)) ||
			some(torrentAndFiles, (f) => /\b[a-fA-F0-9]{8}\b/.test(f)))
	) {
		setUserTorrentsList((prev) => {
			const newList = [...prev];
			const idx = prev.findIndex((i) => i.id === t.id);
			if (idx >= 0) {
				newList[idx].mediaType = 'tv';
				newList[idx].info = filenameParse(t.filename, true);
			}
			return newList;
		});
		await torrentDB.add(t);
	} else if (
		t.mediaType === 'tv' &&
		!hasEpisodes &&
		every(torrentAndFiles, (f) => !/s\d\d\d?.?e\d\d\d?/i.test(f)) &&
		every(torrentAndFiles, (f) => !/season.?\d+/i.test(f)) &&
		every(torrentAndFiles, (f) => !/episodes?\s?\d+/i.test(f)) &&
		every(torrentAndFiles, (f) => !/\b[a-fA-F0-9]{8}\b/.test(f))
	) {
		setUserTorrentsList((prev) => {
			const newList = [...prev];
			const idx = prev.findIndex((i) => i.id === t.id);
			if (idx >= 0) {
				newList[idx].mediaType = 'movie';
				newList[idx].info = filenameParse(t.filename);
			}
			return newList;
		});
		await torrentDB.add(t);
	}

	showInfoForRD(window.localStorage.getItem('settings:player') || defaultPlayer, rdKey, info);
}

export function handleShowInfoForAD(t: UserTorrent, rdKey: string) {
	let player = window.localStorage.getItem('settings:player') || defaultPlayer;
	if (player === 'realdebrid') {
		alert('No player selected');
	}
	showInfoForAD(player, rdKey, t.adData!);
}
