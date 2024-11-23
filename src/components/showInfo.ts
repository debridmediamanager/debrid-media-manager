import { MagnetStatus } from '@/services/allDebrid';
import { TorrentInfoResponse } from '@/services/types';
import { handleShare } from '@/utils/hashList';
import { isVideo } from '@/utils/selectable';
import Swal from 'sweetalert2';

// Utility functions
const formatSize = (bytes: number): { size: number; unit: string } => {
	const isGB = bytes >= 1024 ** 3;
	return {
		size: bytes / (isGB ? 1024 ** 3 : 1024 ** 2),
		unit: isGB ? 'GB' : 'MB',
	};
};

// Types
interface ActionButtonProps {
	link?: string;
	onClick?: string;
	text?: string;
	linkParam?: { name: string; value: string };
}

interface LibraryActionButtonProps {
	onClick: string;
}

interface FileRowProps {
	id: number;
	path: string;
	size: number;
	isSelected?: boolean;
	isPlayable?: boolean;
	actions: string[];
}

interface InfoTableRow {
	label: string;
	value: string | number;
}

// API returns selected as a number (0 or 1)
interface ApiTorrentFile {
	id: number;
	path: string;
	bytes: number;
	selected: number;
}

interface MagnetLink {
	filename: string;
	link: string;
	size: number;
}

// Styles configuration
const buttonStyles = {
	download:
		'border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors',
	watch: 'border-2 border-teal-500 bg-teal-900/30 text-teal-100 hover:bg-teal-800/50 transition-colors',
	cast: 'border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 transition-colors',
	castAll: 'border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 p-3 m-1',
	share: 'border-2 border-indigo-500 bg-indigo-900/30 text-indigo-100 hover:bg-indigo-800/50 p-3 m-1',
	delete: 'border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 p-3 m-1',
	magnet: 'border-2 border-pink-500 bg-pink-900/30 text-pink-100 hover:bg-pink-800/50 p-3 m-1',
	reinsert:
		'border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 p-3 m-1',
	downloadAll:
		'border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 p-3 m-1',
	exportLinks: 'border-2 border-sky-500 bg-sky-900/30 text-sky-100 hover:bg-sky-800/50 p-3 m-1',
};

const icons = {
	download: '📲',
	watch: '🧐',
	cast: '✨',
	castAll: '✨',
	share: '<span style="font-size: 1.2rem;">🚀</span>',
	delete: '<span style="font-size: 1.2rem;">🗑️</span>',
	magnet: '<span style="font-size: 1.2rem;">🧲</span>',
	reinsert: '<span style="font-size: 1.2rem;">🔄</span>',
	downloadAll: '<span style="font-size: 1.2rem;">📲</span>',
	exportLinks: '<span style="font-size: 1.2rem;">📤</span>',
};

// UI Components
const renderButton = (
	type: keyof typeof buttonStyles,
	props: ActionButtonProps | LibraryActionButtonProps
) => {
	const style = buttonStyles[type];
	const icon = icons[type];

	if ('link' in props) {
		return `<form action="${props.link}" method="get" target="_blank" class="inline">
            <input type="hidden" name="${props.linkParam?.name || 'links'}" value="${props.linkParam?.value || props.onClick || ''}" />
            <button type="submit" class="inline m-0 ${style} text-xs rounded px-1 haptic-sm">${icon} ${props.text || type}</button>
        </form>`;
	}

	// Only apply larger text and touch-manipulation to library action buttons
	const isLibraryAction = [
		'share',
		'delete',
		'magnet',
		'reinsert',
		'downloadAll',
		'exportLinks',
		'castAll',
	].includes(type);
	const textSize = isLibraryAction ? 'text-base' : 'text-xs';
	const touchClass = isLibraryAction ? 'touch-manipulation' : '';

	return `<button type="button" class="inline ${style} ${textSize} rounded cursor-pointer ${touchClass}" onclick="${props.onClick}">${icon} ${'text' in props ? props.text || type : ''}</button>`;
};

const renderFileRow = (file: FileRowProps, showCheckbox: boolean = false): string => {
	const { size, unit } = formatSize(file.size);
	const checkboxId = `file-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
	const checkboxColumn = showCheckbox
		? `
        <td class="pr-2">
            <input type="checkbox" 
                id="${checkboxId}" 
                class="file-selector"
                data-file-id="${file.id}"
                ${file.isSelected ? 'checked' : ''}
            />
        </td>
    `
		: '';

	return `
        <tr class="${file.isPlayable || file.isSelected ? 'bg-gray-800 font-bold' : 'font-normal'} hover:bg-gray-700 rounded">
            ${checkboxColumn}
            <td class="text-right whitespace-nowrap pr-2">
                ${file.actions.join('')}
            </td>
            <td class="whitespace-nowrap">
        ${showCheckbox ? `<label for="${checkboxId}" class="cursor-pointer">` : ''}
                <span class="text-blue-300">${file.path}</span>
                <span class="text-gray-300 ml-2">${size.toFixed(2)} ${unit}</span>
        ${showCheckbox ? '</label>' : ''}
            </td>
</tr>
        `;
};

const renderInfoTable = (rows: InfoTableRow[]): string => `
    <table class="table-auto w-full mb-4 text-left text-gray-200">
        <tbody>
            ${rows
				.map(
					(row) => `
                <tr>
                    <td class="font-semibold">${row.label}:</td>
                    <td>${row.value.toString()}</td>
                </tr>
            `
				)
				.join('')}
        </tbody>
    </table>
`;

// Core display functions
const renderTorrentInfo = (
	info: TorrentInfoResponse | MagnetStatus,
	isRd: boolean,
	rdKey: string,
	app?: string,
	userId?: string,
	imdbId?: string,
	mediaType?: 'movie' | 'tv'
) => {
	if (isRd) {
		const rdInfo = info as TorrentInfoResponse;
		const showCheckbox = !rdInfo.fake;
		const filesList = rdInfo.files.map((file: ApiTorrentFile, linkIndex: number) => {
			const actions = [];
			if (file.selected === 1) {
				const fileLink = rdInfo.links[linkIndex];
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

					let epRegex = /S(\d+)\s?E(\d+)/i;
					let isTvEpisode = file.path.match(epRegex)?.length ?? 0 > 0;
					if (mediaType === 'tv' && !isTvEpisode) {
						epRegex = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
						isTvEpisode = file.path.match(epRegex)?.length ?? 0 > 0;
					}
					if (
						userId &&
						imdbId &&
						(mediaType === 'movie' || (mediaType === 'tv' && isTvEpisode))
					) {
						actions.push(
							renderButton('cast', {
								onClick: `window.open('/api/stremio/${userId}/cast/${imdbId}?token=${rdKey}&hash=${info.hash}&fileId=${file.id}&mediaType=${mediaType}')`,
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
		const adInfo = info as MagnetStatus;
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

// Main export functions
export const showInfoForRD = async (
	app: string,
	rdKey: string,
	info: TorrentInfoResponse,
	userId: string = '',
	imdbId: string = '',
	mediaType: 'movie' | 'tv' = 'movie'
): Promise<void> => {
	let warning = '';
	const isIntact =
		info.fake || info.files.filter((f) => f.selected === 1).length === info.links.length;

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
		.map((l) => encodeURIComponent(l))
		.join('%0A')}`;
	const libraryActions = !info.fake
		? `
    <div class="mb-4 flex justify-center items-center flex-wrap">
        ${renderButton('share', { onClick: `window.open('${await handleShare(torrent)}')` })}
        ${renderButton('delete', { onClick: `window.closePopup(); window.handleDeleteRdTorrent('${rdKey}', 'rd:${info.id}')` })}
        ${renderButton('magnet', { onClick: `window.handleCopyMagnet('${info.hash}')` })}
        ${renderButton('reinsert', { onClick: `window.closePopup(); window.handleReinsertTorrentinRd('${rdKey}', { id: 'rd:${info.id}', hash: '${info.hash}' }, true)` })}
        ${
			userId
				? renderButton('castAll', {
						onClick: `window.open('/api/stremio/${userId}/cast/library/${info.id}?rdToken=${rdKey}')`,
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
						onClick: `exportLinks('${info.original_filename}', [${info.links.map((l) => `'${l}'`).join(',')}])`,
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
                    ${renderTorrentInfo(info, true, rdKey, app, userId, imdbId, mediaType)}
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

		// Define infoRows and add the save button after the info table instead of in the library actions
		const infoRows: InfoTableRow[] = [
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
	rdKey: string,
	info: MagnetStatus,
	userId: string = '',
	imdbId: string = ''
): Promise<void> => {
	const torrent = {
		id: `ad:${info.id}`,
		hash: info.hash,
		filename: info.filename,
		bytes: info.size,
		title: info.filename,
		mediaType: 'other',
	};

	const downloadAllLink = `https://alldebrid.com/service/?url=${info.links.map((l) => encodeURIComponent(l.link)).join('%0D%0A')}`;
	const libraryActions = `
        <div class="mb-4 flex justify-center items-center flex-wrap">
            ${renderButton('share', { onClick: `window.open('${await handleShare(torrent)}')` })}
            ${renderButton('delete', { onClick: `window.closePopup(); window.handleDeleteAdTorrent('${rdKey}', 'ad:${info.id}')` })}
            ${renderButton('magnet', { onClick: `window.handleCopyMagnet('${info.hash}')` })}
            ${renderButton('reinsert', { onClick: `window.closePopup(); window.handleRestartTorrent('${rdKey}', '${info.id}')` })}
            ${info.links.length > 1 ? renderButton('downloadAll', { onClick: `window.open('${downloadAllLink}')` }) : ''}
            ${
				info.links.length > 0
					? renderButton('exportLinks', {
							onClick: `exportLinks('${info.filename}', [${info.links.map((l) => `'${l.link}'`).join(',')}])`,
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
                    ${renderTorrentInfo(info, false, '', app, userId, imdbId)}
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
