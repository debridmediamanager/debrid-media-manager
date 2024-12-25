import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { fetchLatestADTorrents, fetchLatestRDTorrents } from '@/utils/libraryFetching';
import { initializeLibrary } from '@/utils/libraryInitialization';
import { useEffect, useState } from 'react';

export function useLibraryData(rdKey: string | null, adKey: string | null) {
	const torrentDB = new UserTorrentDB();
	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [loading, setLoading] = useState(true);
	const [rdSyncing, setRdSyncing] = useState(true);
	const [adSyncing, setAdSyncing] = useState(true);
	const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());

	const triggerFetchLatestRDTorrents = async (customLimit?: number) => {
		await fetchLatestRDTorrents(
			rdKey,
			torrentDB,
			setUserTorrentsList,
			setLoading,
			setRdSyncing,
			setSelectedTorrents,
			customLimit
		);
	};

	const triggerFetchLatestADTorrents = async () => {
		await fetchLatestADTorrents(
			adKey,
			torrentDB,
			setUserTorrentsList,
			setLoading,
			setAdSyncing,
			setSelectedTorrents
		);
	};

	async function initialize() {
		await initializeLibrary(
			torrentDB,
			setUserTorrentsList,
			setLoading,
			rdKey,
			adKey,
			triggerFetchLatestRDTorrents,
			triggerFetchLatestADTorrents,
			userTorrentsList
		);
	}

	useEffect(() => {
		initialize();
	}, [rdKey, adKey]);

	return {
		userTorrentsList,
		setUserTorrentsList,
		loading,
		rdSyncing,
		adSyncing,
		selectedTorrents,
		setSelectedTorrents,
		triggerFetchLatestRDTorrents,
		triggerFetchLatestADTorrents,
	};
}
