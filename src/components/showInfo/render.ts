import { TorBoxFile } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import { renderButton, renderFileRow } from './components';
import { ApiTorrentFile, MagnetLink } from './types';
import { getEpisodeInfo } from './utils';

export const renderTorrentInfo = (
	info: any,
	isRd: boolean,
	// The API key of whichever service owns this torrent — RD's when `isRd`,
	// AllDebrid's otherwise. Both branches use it to authenticate the watch link.
	serviceKey: string,
	app?: string,
	imdbId?: string,
	mediaType?: 'movie' | 'tv'
) => {
	if (isRd) {
		const rdInfo = info;
		const showCheckbox = !rdInfo.fake;
		// Map each selected file to its link before sorting
		let linkIndex = 0;
		const fileLinkMap = new Map<number, string>();
		for (const file of rdInfo.files) {
			if (file.selected === 1) {
				fileLinkMap.set(file.id, rdInfo.links[linkIndex++]);
			}
		}
		rdInfo.files.sort((a: ApiTorrentFile, b: ApiTorrentFile) => a.path.localeCompare(b.path));
		const filesList = rdInfo.files.map((file: ApiTorrentFile) => {
			const actions = [];
			if (file.selected === 1) {
				const fileLink = fileLinkMap.get(file.id)!;
				if (info.status === 'downloaded' && !rdInfo.fake) {
					actions.push(
						renderButton('download', {
							link: 'https://real-debrid.com/downloader',
							linkParam: { name: 'links', value: fileLink },
							text: 'DL',
						})
					);
				}
				if (info.status === 'downloaded' && app) {
					if (rdInfo.fake) {
						actions.push(
							renderButton('watch', {
								link: `/api/watch/instant/${app}`,
								linkParams: [
									{ name: 'service', value: 'rd' },
									{ name: 'token', value: serviceKey },
									{ name: 'hash', value: info.hash },
									{ name: 'fileId', value: String(file.id) },
									// Sent alongside fileId because a fake info object is
									// built from search results, whose file ids may have
									// come from a different service's availability check.
									{ name: 'fileName', value: file.path },
								],
								text: 'Watch',
							})
						);
					} else {
						actions.push(
							renderButton('watch', {
								link: `/api/watch/${app}`,
								linkParams: [
									{ name: 'service', value: 'rd' },
									{ name: 'token', value: serviceKey },
									{ name: 'hash', value: info.hash },
									{ name: 'link', value: fileLink },
								],
								text: 'Watch',
							})
						);
					}

					const { isTvEpisode } = getEpisodeInfo(file.path, mediaType);
					if (
						serviceKey &&
						imdbId &&
						(mediaType === 'movie' || (mediaType === 'tv' && isTvEpisode))
					) {
						actions.push(
							renderButton('cast', {
								link: `/api/stremio/cast/${imdbId}`,
								linkParams: [
									{ name: 'token', value: serviceKey },
									{ name: 'hash', value: info.hash },
									{ name: 'fileId', value: String(file.id) },
									{ name: 'mediaType', value: mediaType },
								],
								text: 'Cast',
							})
						);
					}
				}
			}
			return renderFileRow(
				{
					id: file.id,
					path: file.path,
					size: file.bytes,
					isSelected: file.selected === 1,
					actions,
				},
				showCheckbox
			);
		});
		return filesList.join('');
	} else {
		const adInfo = info;
		adInfo.links.sort((a: MagnetLink, b: MagnetLink) => a.filename.localeCompare(b.filename));
		const filesList = adInfo.links.map((file: MagnetLink) => {
			const isPlayable = Boolean(isVideo({ path: file.filename }));
			const actions = [
				renderButton('download', {
					link: 'https://alldebrid.com/service/',
					linkParam: { name: 'url', value: file.link },
					text: 'DL',
				}),
			];
			// The row already holds an alldebrid.com/f/ link, so the server only has
			// to unlock it — no magnet upload, which AllDebrid refuses from
			// datacenter IPs anyway.
			if (isPlayable && app && serviceKey) {
				actions.push(
					renderButton('watch', {
						link: `/api/watch/${app}`,
						linkParams: [
							{ name: 'service', value: 'ad' },
							{ name: 'token', value: serviceKey },
							{ name: 'link', value: file.link },
						],
						text: 'Watch',
					})
				);
			}
			return renderFileRow({
				id: 0,
				path: file.filename,
				size: file.size,
				isPlayable,
				actions,
			});
		});
		return filesList.join('');
	}
};

export const renderTorrentInfoTB = (
	files: TorBoxFile[],
	// A web download is not a torrent: it lives in TorBox's separate webdl
	// namespace, so it resolves through 'tbw' rather than 'tb'.
	options: { tbKey?: string; app?: string; hash?: string; isWebDownload?: boolean } = {}
) => {
	const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
	const filesList = sorted.map((file) => {
		const isPlayable = Boolean(isVideo({ path: file.name }));
		const actions: string[] = [];
		if (isPlayable && options.app && options.tbKey && options.hash) {
			actions.push(
				renderButton('watch', {
					link: `/api/watch/instant/${options.app}`,
					linkParams: [
						{ name: 'service', value: options.isWebDownload ? 'tbw' : 'tb' },
						{ name: 'token', value: options.tbKey },
						{ name: 'hash', value: options.hash },
						{ name: 'fileName', value: file.name },
					],
					text: 'Watch',
				})
			);
		}
		return renderFileRow({
			id: file.id,
			path: file.name,
			size: file.size,
			isPlayable,
			actions,
		});
	});
	return filesList.join('');
};
