import Swal from 'sweetalert2';
import { handleShare } from '../../utils/hashList';
import { isVideo } from '../../utils/selectable';
import { renderButton, renderFileRow, renderInfoTable } from './components';
import { ApiTorrentFile, MagnetLink } from './types';
import { getEpisodeInfo } from './utils';

const renderTorrentInfo = (
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

export const showInfoForRD = async (
	app: string,
	rdKey: string,
	info: any,
	imdbId: string = '',
	mediaType: 'movie' | 'tv' = 'movie',
	shouldDownloadMagnets?: boolean
): Promise<void> => {
	let warning = '';
	const isIntact =
		info.fake ||
		info.files.filter((f: ApiTorrentFile) => f.selected === 1).length === info.links.length;

	if (info.progress === 100 && !isIntact) {
		if (info.links.length === 1) {
			warning = `<div class="text-sm text-red-400">Warning: This torrent appears to have been rar'ed by Real-Debrid<br/></div>`;
		} else {
			warning = `<div class="text-sm text-red-400">Warning: Some files have expired</div>`;
		}
	}

	const torrent = {
		id: `rd:${info.id}`,
		hash: info.hash,
		filename: info.filename,
		bytes: info.bytes,
		title: info.filename,
		mediaType,
	};

	const downloadAllLink = `https://real-debrid.com/downloader?links=${info.links
		.slice(0, 553)
		.map((l: string) => encodeURIComponent(l))
		.join('%0A')}`;
	const libraryActions = !info.fake
		? `
    <div class="mb-4 flex justify-center items-center flex-wrap">
        ${renderButton('share', { onClick: `window.open('${await handleShare(torrent)}')` })}
        ${renderButton('delete', { onClick: `window.closePopup(); window.handleDeleteRdTorrent('${rdKey}', 'rd:${info.id}')` })}
        ${renderButton('magnet', { onClick: `window.handleCopyMagnet('${info.hash}', ${shouldDownloadMagnets})`, text: shouldDownloadMagnets ? 'Download' : 'Copy' })}
        ${renderButton('reinsert', { onClick: `window.closePopup(); window.handleReinsertTorrentinRd('${rdKey}', { id: 'rd:${info.id}', hash: '${info.hash}' }, true)` })}
        ${
			rdKey
				? renderButton('castAll', {
						onClick: `window.open('/api/stremio/cast/library/${info.id}:${info.hash}?rdToken=${rdKey}')`,
					})
				: ''
		}
        ${
			info.links.length > 0
				? renderButton('downloadAll', {
						onClick: `window.open('${downloadAllLink}')`,
					})
				: ''
		}
        ${
			info.links.length > 0
				? renderButton('exportLinks', {
						onClick: `exportLinks('${info.original_filename}', [${info.links.map((l: string) => `'${l}'`).join(',')}])`,
					})
				: ''
		}
    </div>`
		: '';

	let html = `<h1 class="text-lg font-bold mt-6 mb-4 text-gray-100">${info.filename}</h1>
    ${libraryActions}
    <hr class="border-gray-600"/>
    <div class="text-sm max-h-60 mb-4 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfo(info, true, rdKey, app, imdbId, mediaType)}
                </tbody>
            </table>
        </div>
    </div>`;

	if (!info.fake) {
		const saveButton = `
            <div class="m-2">
                <button
                    class="px-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98]"
                    onclick="window.saveSelection('rd:${info.id}', '${info.hash}', Array.from(document.querySelectorAll('.file-selector:checked')).map(cb => cb.dataset.fileId))"
                >
                    💾 Save File Selection
                </button>
            </div>
        `;

		const infoRows = [
			{ label: 'Size', value: (info.bytes / 1024 ** 3).toFixed(2) + ' GB' },
			{ label: 'ID', value: info.id },
			{ label: 'Original filename', value: info.original_filename },
			{ label: 'Original size', value: (info.original_bytes / 1024 ** 3).toFixed(2) + ' GB' },
			{ label: 'Status', value: info.status },
			...(info.status === 'downloading'
				? [
						{ label: 'Progress', value: info.progress.toFixed(2) + '%' },
						{ label: 'Speed', value: (info.speed / 1024).toFixed(2) + ' KB/s' },
						{ label: 'Seeders', value: info.seeders },
					]
				: []),
			{ label: 'Added', value: new Date(info.added).toLocaleString() },
			{ label: 'Progress', value: info.progress + '%' },
		];
		html = html.replace(
			'<hr class="border-gray-600"/>',
			`<div class="text-sm text-gray-200">
            ${renderInfoTable(infoRows)}
            ${warning}
            ${saveButton}
        </div>`
		);
	}

	await Swal.fire({
		html,
		showConfirmButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
	});
};

export const showInfoForAD = async (
	app: string,
	adKey: string,
	info: any,
	imdbId: string = '',
	shouldDownloadMagnets?: boolean
): Promise<void> => {
	const torrent = {
		id: `ad:${info.id}`,
		hash: info.hash,
		filename: info.filename,
		bytes: info.size,
		title: info.filename,
		mediaType: 'other',
	};

	const downloadAllLink = `https://alldebrid.com/service/?url=${info.links.map((l: MagnetLink) => encodeURIComponent(l.link)).join('%0D%0A')}`;
	const libraryActions = `
        <div class="mb-4 flex justify-center items-center flex-wrap">
            ${renderButton('share', { onClick: `window.open('${await handleShare(torrent)}')` })}
            ${renderButton('delete', { onClick: `window.closePopup(); window.handleDeleteAdTorrent('${adKey}', 'ad:${info.id}')` })}
            ${renderButton('magnet', { onClick: `window.handleCopyMagnet('${info.hash}', ${shouldDownloadMagnets})`, text: shouldDownloadMagnets ? 'Download' : 'Copy' })}
            ${renderButton('reinsert', { onClick: `window.closePopup(); window.handleRestartTorrent('${adKey}', '${info.id}')` })}
            ${info.links.length > 1 ? renderButton('downloadAll', { onClick: `window.open('${downloadAllLink}')` }) : ''}
            ${
				info.links.length > 0
					? renderButton('exportLinks', {
							onClick: `exportLinks('${info.filename}', [${info.links.map((l: MagnetLink) => `'${l.link}'`).join(',')}])`,
						})
					: ''
			}
        </div>`;

	const html = `<h1 class="text-lg font-bold mt-6 mb-4 text-gray-100">${info.filename}</h1>
    ${libraryActions}
    <div class="text-sm text-gray-200">
        ${renderInfoTable([
			{ label: 'Size', value: (info.size / 1024 ** 3).toFixed(2) + ' GB' },
			{ label: 'ID', value: info.id },
			{ label: 'Status', value: `${info.status} (code: ${info.statusCode})` },
			{ label: 'Added', value: new Date(info.uploadDate * 1000).toLocaleString() },
		])}
    </div>
    <div class="text-sm max-h-60 mb-4 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfo(info, false, '', app, imdbId)}
                </tbody>
            </table>
        </div>
    </div>`;

	await Swal.fire({
		html,
		showConfirmButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
	});
};
