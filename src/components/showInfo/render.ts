import { TorBoxFile } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import { renderButton, renderFileRow } from './components';
import { ApiTorrentFile, MagnetLink } from './types';
import { getEpisodeInfo } from './utils';

export const renderTorrentInfo = (
	info: any,
	isRd: boolean,
	rdKey: string,
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
									{ name: 'token', value: rdKey },
									{ name: 'hash', value: info.hash },
									{ name: 'fileId', value: String(file.id) },
								],
								text: 'Watch',
							})
						);
					} else {
						actions.push(
							renderButton('watch', {
								link: `/api/watch/${app}`,
								linkParams: [
									{ name: 'token', value: rdKey },
									{ name: 'hash', value: info.hash },
									{ name: 'link', value: fileLink },
								],
								text: 'Watch',
							})
						);
					}

					const { isTvEpisode } = getEpisodeInfo(file.path, mediaType);
					if (
						rdKey &&
						imdbId &&
						(mediaType === 'movie' || (mediaType === 'tv' && isTvEpisode))
					) {
						actions.push(
							renderButton('cast', {
								link: `/api/stremio/cast/${imdbId}`,
								linkParams: [
									{ name: 'token', value: rdKey },
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
			const actions = [
				renderButton('download', {
					link: 'https://alldebrid.com/service/',
					linkParam: { name: 'url', value: file.link },
					text: 'DL',
				}),
			];
			return renderFileRow({
				id: 0,
				path: file.filename,
				size: file.size,
				isPlayable: Boolean(isVideo({ path: file.filename })),
				actions,
			});
		});
		return filesList.join('');
	}
};

export const renderTorrentInfoTB = (files: TorBoxFile[]) => {
	const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
	const filesList = sorted.map((file) => {
		return renderFileRow({
			id: file.id,
			path: file.name,
			size: file.size,
			isPlayable: Boolean(isVideo({ path: file.name })),
			actions: [],
		});
	});
	return filesList.join('');
};
