import { addHashAsMagnet, selectFiles } from '@/services/realDebrid';
import { handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { magnetToastOptions } from '@/utils/toastOptions';
import axios from 'axios';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import { handleShare } from '../../utils/hashList';
import { isVideo } from '../../utils/selectable';
import { renderButton, renderInfoTable } from './components';
import { renderTorrentInfo } from './render';
import { ApiTorrentFile, MagnetLink, MediaInfoResponse } from './types';
import { generatePasswordHash, getStreamInfo } from './utils';

declare global {
	interface Window {
		addHashAsMagnet: typeof addHashAsMagnet;
		selectFiles: typeof selectFiles;
		handleDeleteRdTorrent: typeof handleDeleteRdTorrent;
		handleReinsertTorrentinRd: (
			key: string,
			torrent: any,
			reload: boolean,
			selectedFileIds?: string[]
		) => Promise<void>;
		closePopup: () => void;
		toast: typeof toast;
		magnetToastOptions: typeof magnetToastOptions;
		selectAllVideos: () => void;
		unselectAll: () => void;
		resetSelection?: () => void;
		triggerFetchLatestRDTorrents: (limit?: number) => Promise<void>;
	}
}

if (typeof window !== 'undefined') {
	// Expose required functions to window
	window.addHashAsMagnet = addHashAsMagnet;
	window.selectFiles = selectFiles;
	window.handleDeleteRdTorrent = handleDeleteRdTorrent;
	window.closePopup = () => Swal.close();
	window.toast = toast;
	window.magnetToastOptions = magnetToastOptions;

	window.selectAllVideos = () => {
		const checkboxes = document.querySelectorAll<HTMLInputElement>('.file-selector');
		checkboxes.forEach((checkbox) => {
			const filePath = checkbox.dataset.filePath;
			if (filePath && isVideo({ path: filePath })) {
				checkbox.checked = true;
			}
		});
	};

	window.unselectAll = () => {
		const checkboxes = document.querySelectorAll<HTMLInputElement>('.file-selector');
		checkboxes.forEach((checkbox) => {
			checkbox.checked = false;
		});
	};
}

export const showInfoForRD = async (
	app: string,
	rdKey: string,
	info: any,
	imdbId: string = '',
	mediaType: 'movie' | 'tv' = 'movie',
	shouldDownloadMagnets?: boolean
): Promise<void> => {
	let warning = '';
	let mediaInfo: MediaInfoResponse | null = null;

	try {
		const password = await generatePasswordHash(info.hash);
		const response = await axios.get<MediaInfoResponse>(
			`https://debridmediamanager.com/mediainfo?hash=${info.hash}&password=${password}`
		);
		mediaInfo = response.data;
	} catch (error) {
		console.error('MediaInfo error:', error);
		// Silently fail as media info is optional
	}
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
        ${renderButton('reinsert', {
			onClick: `(async () => {
            const selectedFileIds = Array.from(document.querySelectorAll('.file-selector:checked')).map(cb => cb.dataset.fileId);
            window.closePopup(); 
            window.handleReinsertTorrentinRd('${rdKey}', { id: 'rd:${info.id}', hash: '${info.hash}' }, true, selectedFileIds);
          })()`,
		})}
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
		${
			info.links.length > 0
				? renderButton('generateStrm', {
						onClick: `generateStrmFiles('${info.original_filename}', [${info.links.map((l: string) => `'${l}'`).join(',')}])`,
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

	const saveButton = !info.fake
		? (() => {
				// Store initial selection state
				const initialSelection = info.files.reduce(
					(acc: { [key: string]: boolean }, f: ApiTorrentFile) => {
						acc[f.id] = f.selected === 1;
						return acc;
					},
					{}
				);

				window.resetSelection = () => {
					const checkboxes =
						document.querySelectorAll<HTMLInputElement>('.file-selector');
					checkboxes.forEach((checkbox) => {
						const fileId = checkbox.dataset.fileId;
						checkbox.checked = fileId ? initialSelection[fileId] : false;
					});
				};

				return `
				<div class="m-2 flex gap-2 justify-center">
					<button
						class="px-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98]"
						onclick="window.selectAllVideos()"
					>
						🎥 Select All Videos
					</button>
					<button
						class="px-2 bg-gradient-to-r from-gray-600 to-gray-500 hover:from-gray-500 hover:to-gray-400 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98]"
						onclick="window.unselectAll()"
					>
						❌ Unselect All
					</button>
					<button
						class="px-2 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98]"
						onclick="window.resetSelection()"
					>
						↩️ Reset Selection
					</button>
					<button
						class="px-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98]"
						onclick="(async () => {
							const oldId = 'rd:${info.id}';
							try {
								const newId = await window.addHashAsMagnet('${rdKey}', '${info.hash}');
								await window.selectFiles('${rdKey}', newId, Array.from(document.querySelectorAll('.file-selector:checked')).map(cb => cb.dataset.fileId));
								await window.handleDeleteRdTorrent('${rdKey}', oldId, true);
								window.closePopup();
								window.toast.success('Selection saved and torrent reinserted', window.magnetToastOptions);
								// Refresh the library list with the updated torrent
								if (typeof window.triggerFetchLatestRDTorrents === 'function') {
									await window.triggerFetchLatestRDTorrents(2);
								}
							} catch (error) {
								window.toast.error('Error saving selection: ' + error, window.magnetToastOptions);
							}
						})()"
					>
						💾 Save File Selection
					</button>
				</div>
			`;
			})()
		: '';

	const infoRows = info.fake
		? [
				{ label: 'Size', value: (info.bytes / 1024 ** 3).toFixed(2) + ' GB' },
				...getStreamInfo(mediaInfo),
			]
		: [
				{ label: 'Size', value: (info.bytes / 1024 ** 3).toFixed(2) + ' GB' },
				{ label: 'ID', value: info.id },
				{ label: 'Original filename', value: info.original_filename },
				{
					label: 'Original size',
					value: (info.original_bytes / 1024 ** 3).toFixed(2) + ' GB',
				},
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
				...getStreamInfo(mediaInfo),
			];

	html = html.replace(
		'<hr class="border-gray-600"/>',
		`<div class="text-sm text-gray-200">
		${renderInfoTable(infoRows)}
		${warning}
		${saveButton}
	</div>`
	);

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
	let mediaInfo: MediaInfoResponse | null = null;

	try {
		const password = await generatePasswordHash(info.hash);
		const response = await axios.get<MediaInfoResponse>(
			`https://debridmediamanager.com/mediainfo?hash=${info.hash}&password=${password}`
		);
		mediaInfo = response.data;
	} catch (error) {
		console.error('MediaInfo error:', error);
		// Silently fail as media info is optional
	}
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
   ${
		info.links.length > 0
			? renderButton('generateStrm', {
					onClick: `generateStrmFiles('${info.filename}', [${info.links.map((l: MagnetLink) => `'${l.link}'`).join(',')}])`,
				})
			: ''
   }
        </div>`;

	const allInfoRows = [
		{ label: 'Size', value: (info.size / 1024 ** 3).toFixed(2) + ' GB' },
		{ label: 'ID', value: info.id },
		{ label: 'Status', value: `${info.status} (code: ${info.statusCode})` },
		{ label: 'Added', value: new Date(info.uploadDate * 1000).toLocaleString() },
		...getStreamInfo(mediaInfo),
	];

	const html = `<h1 class="text-lg font-bold mt-6 mb-4 text-gray-100">${info.filename}</h1>
    ${libraryActions}
    <div class="text-sm text-gray-200">
        ${renderInfoTable(allInfoRows)}
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
