import { SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleAddAsMagnetInTb,
} from '@/utils/addMagnet';
import { submitAvailability } from '@/utils/availability';
import {
	handleDeleteAdTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import { convertToUserTorrent, fetchAllDebrid } from '@/utils/fetchTorrents';
import { instantCheckInRd } from '@/utils/instantChecks';
import { generateTokenAndHash } from '@/utils/token';
import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';

const torrentDB = new UserTorrentDB();

interface UseTorrentOperationsProps {
	imdbId: string;
	rdKey: string | null;
	adKey: string | null;
	torboxKey: string | null;
	setSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>;
	sortFunction: (results: SearchResult[]) => SearchResult[];
}

export const useTorrentOperations = ({
	imdbId,
	rdKey,
	adKey,
	torboxKey,
	setSearchResults,
	sortFunction,
}: UseTorrentOperationsProps) => {
	const [hashAndProgress, setHashAndProgress] = useState<Record<string, number>>({});
	const isMounted = useRef(true);

	const fetchHashAndProgress = useCallback(async (hash?: string) => {
		const torrents = await torrentDB.all();
		const records: Record<string, number> = {};
		for (const t of torrents) {
			if (hash && t.hash !== hash) continue;
			records[`${t.id.substring(0, 3)}${t.hash}`] = t.progress;
		}
		setHashAndProgress((prev) => ({ ...prev, ...records }));
	}, []);

	const addRd = useCallback(
		async (hash: string) => {
			if (!rdKey) return;
			await handleAddAsMagnetInRd(rdKey, hash, async (info: TorrentInfoResponse) => {
				const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
				await Promise.all([
					submitAvailability(tokenWithTimestamp, tokenHash, info, imdbId),
					torrentDB
						.add(convertToUserTorrent(info))
						.then(() => fetchHashAndProgress(hash)),
				]);
			});
		},
		[rdKey, imdbId, fetchHashAndProgress]
	);

	const addAd = useCallback(
		async (hash: string) => {
			if (!adKey) return;
			await handleAddAsMagnetInAd(adKey, hash);
			await fetchAllDebrid(
				adKey,
				async (torrents: UserTorrent[]) => await torrentDB.addAll(torrents)
			);
			await fetchHashAndProgress();
		},
		[adKey, fetchHashAndProgress]
	);

	const addTb = useCallback(
		async (hash: string) => {
			if (!torboxKey) return;
			await handleAddAsMagnetInTb(torboxKey, hash, async (userTorrent: UserTorrent) => {
				await torrentDB.add(userTorrent);
				await fetchHashAndProgress();
			});
		},
		[torboxKey, fetchHashAndProgress]
	);

	const deleteRd = useCallback(
		async (hash: string) => {
			if (!rdKey) return;
			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('rd:')) continue;
				await handleDeleteRdTorrent(rdKey, t.id);
				await torrentDB.deleteByHash('rd', hash);
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`rd:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[rdKey]
	);

	const deleteAd = useCallback(
		async (hash: string) => {
			if (!adKey) return;
			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('ad:')) continue;
				await handleDeleteAdTorrent(adKey, t.id);
				await torrentDB.deleteByHash('ad', hash);
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`ad:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[adKey]
	);

	const deleteTb = useCallback(
		async (hash: string) => {
			if (!torboxKey) return;
			const torrents = await torrentDB.getAllByHash(hash);
			for (const t of torrents) {
				if (!t.id.startsWith('tb:')) continue;
				await handleDeleteTbTorrent(torboxKey, t.id);
				await torrentDB.deleteByHash('tb', hash);
				setHashAndProgress((prev) => {
					const newHashAndProgress = { ...prev };
					delete newHashAndProgress[`tb:${hash}`];
					return newHashAndProgress;
				});
			}
		},
		[torboxKey]
	);

	const handleCheckAvailability = useCallback(
		async (result: SearchResult) => {
			if (!rdKey) return;

			if (result.rdAvailable) {
				toast.success('This torrent is already available in Real Debrid');
				return;
			}

			const toastId = toast.loading('Checking availability...');

			try {
				// Check if torrent is in progress
				if (`rd:${result.hash}` in hashAndProgress) {
					await deleteRd(result.hash);
					await addRd(result.hash);
				} else {
					await addRd(result.hash);
					await deleteRd(result.hash);
				}

				toast.success('Availability check complete', { id: toastId });

				// Refetch data instead of reloading
				if (isMounted.current) {
					const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
					const hashArr = [result.hash];
					await instantCheckInRd(
						tokenWithTimestamp,
						tokenHash,
						imdbId,
						hashArr,
						setSearchResults,
						sortFunction
					);
				}
			} catch (error) {
				toast.error('Failed to check availability', { id: toastId });
				console.error('Availability check error:', error);
			}
		},
		[rdKey, hashAndProgress, deleteRd, addRd, imdbId, setSearchResults, sortFunction]
	);

	return {
		hashAndProgress,
		fetchHashAndProgress,
		addRd,
		addAd,
		addTb,
		deleteRd,
		deleteAd,
		deleteTb,
		handleCheckAvailability,
		setIsMounted: (value: boolean) => {
			isMounted.current = value;
		},
	};
};
