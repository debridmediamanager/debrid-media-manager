import { UserTorrent } from '@/torrent/userTorrent';

export function handleSelectTorrent(
	id: string,
	selectedTorrents: Set<string>,
	setSelectedTorrents: (fn: (prev: Set<string>) => Set<string>) => void
) {
	if (selectedTorrents.has(id)) {
		setSelectedTorrents((prev) => {
			prev.delete(id);
			return new Set(prev);
		});
	} else {
		setSelectedTorrents((prev) => {
			prev.add(id);
			return new Set(prev);
		});
	}
}

export function selectShown(
	currentPageData: UserTorrent[],
	setSelectedTorrents: (fn: (prev: Set<string>) => Set<string>) => void
) {
	setSelectedTorrents((prev) => {
		currentPageData.forEach((t) => prev.add(t.id));
		return new Set(prev);
	});
}

export function resetSelection(setSelectedTorrents: (torrents: Set<string>) => void) {
	setSelectedTorrents(new Set());
}
