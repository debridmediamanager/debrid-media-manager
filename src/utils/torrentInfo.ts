import { showInfoForAD, showInfoForRD, showInfoForTB } from '@/components/showInfo/index';
import { getTorrentInfo } from '@/services/realDebrid';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { defaultPlayer } from '@/utils/settings';
import { filenameParse } from '@ctrl/video-filename-parser';
import { every, some } from 'lodash';
import { Dispatch, SetStateAction } from 'react';
import Modal from '../components/modals/modal';
import { handleReinsertTorrentinRd } from './addMagnet';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { getRdStatus } from './fetchTorrents';
import { fetchLatestRDTorrents } from './libraryFetching';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';

export async function handleShowInfoForRD(
	t: UserTorrent,
	rdKey: string,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	torrentDB: UserTorrentDB,
	setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>
) {
	Modal.showLoading();
	let info: TorrentInfoResponse;
	try {
		info = await getTorrentInfo(rdKey, t.id.substring(3));
	} catch (error) {
		Modal.close();
		throw error;
	}

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

	// Define handlers and pass into the modal to avoid window globals
	const onDeleteRd = async (key: string, id: string) => {
		await handleDeleteRdTorrent(key, id);
		setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
		await torrentDB.deleteById(id);
		setSelectedTorrents((prev) => {
			prev.delete(id);
			return new Set(prev);
		});
		Modal.close();
	};

	const onReinsertRd = async (
		key: string,
		torrent: UserTorrent,
		reload: boolean,
		selectedFileIds?: string[]
	) => {
		const baseForReinsert: UserTorrent = {
			...t,
			id: torrent.id,
			hash: torrent.hash,
		};

		const newId = await handleReinsertTorrentinRd(
			key,
			baseForReinsert,
			reload,
			selectedFileIds
		);

		let newInfo: TorrentInfoResponse | undefined;
		try {
			newInfo = await getTorrentInfo(key, newId.substring(3));
		} catch (error) {
			console.error('Failed to fetch reinserted torrent info', error);
		}

		const addedDate = newInfo?.added
			? new Date(newInfo.added)
			: baseForReinsert.added
				? new Date(baseForReinsert.added)
				: new Date();

		let updatedTorrent: UserTorrent | undefined;

		setUserTorrentsList((prev) => {
			const existing = prev.find((item) => item.id === torrent.id);
			const base = existing ? { ...existing } : { ...baseForReinsert };
			updatedTorrent = {
				...base,
				id: newId,
				added: addedDate,
				...(newInfo
					? {
							serviceStatus: newInfo.status,
							status: getRdStatus(newInfo),
							progress: newInfo.progress,
							seeders: newInfo.seeders,
							speed: newInfo.speed,
							links: newInfo.links,
						}
					: {}),
			};
			const filtered = prev.filter((item) => item.id !== torrent.id);
			return [...filtered, updatedTorrent!];
		});

		const dbRecord = updatedTorrent ?? {
			...baseForReinsert,
			id: newId,
			added: addedDate,
		};

		await torrentDB.upsert(dbRecord);
		await torrentDB.deleteById(torrent.id);

		setSelectedTorrents((prev) => {
			prev.delete(torrent.id);
			return new Set(prev);
		});

		Modal.close();
	};

	void showInfoForRD(
		window.localStorage.getItem('settings:player') || defaultPlayer,
		rdKey,
		info,
		'',
		'movie',
		undefined,
		{
			onDeleteRd,
			onReinsertRd,
			onRefreshRd: async () => {
				await fetchLatestRDTorrents(
					rdKey,
					torrentDB,
					setUserTorrentsList,
					(loading) => console.log('Loading:', loading),
					(syncing) => console.log('Syncing:', syncing),
					setSelectedTorrents,
					2
				);
			},
		}
	);
}

export function handleShowInfoForAD(t: UserTorrent, adKey: string) {
	let player = window.localStorage.getItem('settings:player') || defaultPlayer;
	if (player === 'realdebrid') {
		alert('No player selected');
	}
	showInfoForAD(player, adKey, t.adData!);
}

export async function handleShowInfoForTB(
	t: UserTorrent,
	tbKey: string,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>
) {
	if (!t.tbData) {
		alert(`No TorBox data available for: ${t.title}`);
		return;
	}

	const onDeleteTb = async (key: string, id: string) => {
		const { handleDeleteTbTorrent } = await import('./deleteTorrent');
		await handleDeleteTbTorrent(key, id);
		setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
		setSelectedTorrents((prev) => {
			prev.delete(id);
			return new Set(prev);
		});
		Modal.close();
	};

	void showInfoForTB(tbKey, t.tbData, undefined, { onDeleteTb });
}
