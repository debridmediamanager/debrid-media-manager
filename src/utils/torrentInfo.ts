import { showInfoForAD, showInfoForRD } from '@/components/showInfo';
import { getTorrentInfo } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { defaultPlayer } from '@/utils/settings';
import { filenameParse } from '@ctrl/video-filename-parser';
import { every, some } from 'lodash';
import { Dispatch, SetStateAction } from 'react';
import Swal from 'sweetalert2';
import { handleReinsertTorrentinRd } from './addMagnet';
import { handleCopyOrDownloadMagnet } from './copyMagnet';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { getRdStatus } from './fetchTorrents';
import { handleShare } from './hashList';
import { fetchLatestRDTorrents } from './libraryFetching';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';

export async function handleShowInfoForRD(
	t: UserTorrent,
	rdKey: string,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	torrentDB: UserTorrentDB,
	setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>
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

	// Set up window handlers
	(window as any).handleShare = handleShare;
	(window as any).handleDeleteRdTorrent = async (key: string, id: string) => {
		await handleDeleteRdTorrent(key, id);
		setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
		await torrentDB.deleteById(id);
		setSelectedTorrents((prev) => {
			prev.delete(id);
			return new Set(prev);
		});
		Swal.close();
	};
	(window as any).handleCopyMagnet = handleCopyOrDownloadMagnet;
	(window as any).handleReinsertTorrentinRd = async (
		key: string,
		torrent: UserTorrent,
		reload: boolean,
		selectedFileIds?: string[]
	) => {
		await handleReinsertTorrentinRd(key, torrent, reload, selectedFileIds);
		await fetchLatestRDTorrents(
			rdKey,
			torrentDB,
			setUserTorrentsList,
			(loading) => console.log('Loading:', loading),
			(syncing) => console.log('Syncing:', syncing),
			setSelectedTorrents,
			2
		);
		setUserTorrentsList((prev) => prev.filter((t) => t.id !== torrent.id));
		await torrentDB.deleteById(torrent.id);
		setSelectedTorrents((prev) => {
			prev.delete(torrent.id);
			return new Set(prev);
		});
		Swal.close();
	};
	// Add a method to trigger the fetch for latest RD torrents
	(window as any).triggerFetchLatestRDTorrents = async (limit: number = 2) => {
		await fetchLatestRDTorrents(
			rdKey,
			torrentDB,
			setUserTorrentsList,
			(loading) => console.log('Loading:', loading),
			(syncing) => console.log('Syncing:', syncing),
			setSelectedTorrents,
			limit
		);
	};
	(window as any).closePopup = Swal.close;
	(window as any).saveSelection = async (key: string, hash: string, fileIDs: string[]) => {
		console.log('Saving selection', key, hash, fileIDs);
		Swal.close();
	};

	showInfoForRD(window.localStorage.getItem('settings:player') || defaultPlayer, rdKey, info);
}

export function handleShowInfoForAD(t: UserTorrent, adKey: string) {
	let player = window.localStorage.getItem('settings:player') || defaultPlayer;
	if (player === 'realdebrid') {
		alert('No player selected');
	}
	showInfoForAD(player, adKey, t.adData!);
}
