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
		let linkIndex = 0;
		rdInfo.files.sort((a: ApiTorrentFile, b: ApiTorrentFile) => a.path.localeCompare(b.path));
		const filesList = rdInfo.files.map((file: ApiTorrentFile) => {
			const actions = [];
			if (file.selected === 1) {
				const fileLink = rdInfo.links[linkIndex++];
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
								onClick: `window.open('/api/watch/instant/${app}?token=${rdKey}&hash=${info.hash}&fileId=${file.id}')`,
								text: 'Watch',
							})
						);
					} else {
						actions.push(
							renderButton('watch', {
								onClick: `window.open('/api/watch/${app}?token=${rdKey}&hash=${info.hash}&link=${fileLink}')`,
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
								onClick: `window.open('/api/stremio/cast/${imdbId}?token=${rdKey}&hash=${info.hash}&fileId=${file.id}&mediaType=${mediaType}')`,
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
