import { getSeedboxTorrent, type DebridLinkFile } from '@/services/debridLink';
import {
	exploreOffcloudCloud,
	getOffcloudCacheInfo,
	getOffcloudCloudStatus,
	joinExploreWithCacheInfo,
	type OffcloudFile,
} from '@/services/offcloud';
import { getPremiumizeItemDetails } from '@/services/premiumize';
import { addHashAsMagnet, proxyUnrestrictLink, selectFiles } from '@/services/realDebrid';
import { requestDownloadLink, requestWebDownloadLink } from '@/services/torbox';
import { TorBoxTorrentInfo } from '@/services/types';
import { handleRestartTorrent } from '@/utils/addMagnet';
import { handleCopyOrDownloadMagnet } from '@/utils/copyMagnet';
import { getDebridLinkServiceStatus, getDebridLinkStatusText } from '@/utils/debridLinkStatus';
import {
	handleDeleteAdTorrent,
	handleDeleteDlTorrent,
	handleDeleteOcTorrent,
	handleDeletePmTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import { parseOffcloudRowId } from '@/utils/offcloudRow';
import { getOffcloudStatusText } from '@/utils/offcloudStatus';
import { getPremiumizeStatusText } from '@/utils/premiumizeStatus';
import { magnetToastOptions } from '@/utils/toastOptions';
import { toWebDownloadRowId } from '@/utils/torboxWebDownload';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { handleShare } from '../../utils/hashList';
import { isVideo } from '../../utils/selectable';
import Modal from '../modals/modal';
import { bindCastAllButton } from './castAll';
import { renderButton, renderInfoTable } from './components';
import type { PremiumizeFileRow } from './render';
import {
	renderTorrentInfo,
	renderTorrentInfoDL,
	renderTorrentInfoOC,
	renderTorrentInfoPM,
	renderTorrentInfoTB,
} from './render';
import { icons } from './styles';
import { ApiTorrentFile, MagnetLink } from './types';
import { buildSearchQueryFromFilename, fetchMediaInfo, getStreamInfo } from './utils';
import { bindWatchButtons } from './watchButtons';

// RD: { error: "infringing_file", error_code: 35 }
const getRdError = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		return error.response?.data?.error || null;
	}
	return null;
};

// AD: { status: "error", error: { code: "...", message: "..." } }
const getAdError = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data;
		return data?.error?.message || data?.error || null;
	}
	return null;
};

type ShowInfoHandlers = {
	onDeleteRd?: (rdKey: string, id: string) => Promise<void>;
	onReinsertRd?: (
		rdKey: string,
		torrent: { id: string; hash: string } | any,
		reload: boolean,
		selectedFileIds?: string[]
	) => Promise<void>;
	onDeleteAd?: (adKey: string, id: string) => Promise<void>;
	onRestartAd?: (adKey: string, id: string) => Promise<void>;
	onRefreshRd?: (limit?: number) => Promise<void>; // optional refresh hook
};

export const showInfoForRD = async (
	app: string,
	rdKey: string,
	info: any,
	imdbId: string = '',
	mediaType: 'movie' | 'tv' = 'movie',
	shouldDownloadMagnets?: boolean,
	handlers: ShowInfoHandlers = {}
): Promise<void> => {
	Modal.showLoading();
	let warning = '';
	const mediaInfo = await fetchMediaInfo(info.hash);
	const isIntact =
		info.fake ||
		info.files.filter((f: ApiTorrentFile) => f.selected === 1).length === info.links.length;

	if (info.progress === 100 && !isIntact) {
		if (info.links.length === 1) {
			warning = `<div class="text-sm text-red-400">Warning: This torrent appears to have been rar'ed by Real-Debrid (<a class="underline text-red-200" href="https://www.patreon.com/posts/that-annoying-rd-144564359" target="_blank" rel="noreferrer">zurg supports rar files</a>)<br/></div>`;
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

	const downloadAllLinksParam = info.links.slice(0, 553).join('\n');
	const originalFilename = (info.original_filename || '').trim();
	const searchQuery = buildSearchQueryFromFilename(info.original_filename, mediaType);
	const searchAgainButton =
		originalFilename && searchQuery && !info.fake
			? renderButton('searchAgain', {
					link: '/search',
					linkParam: { name: 'query', value: searchQuery },
				})
			: '';
	const libraryActions = !info.fake
		? `
    <div class="mb-3 flex justify-center items-center flex-wrap">
        ${renderButton('share', { link: `${await handleShare(torrent)}` })}
        ${renderButton('delete', { id: 'btn-delete-rd' })}
        ${renderButton('magnet', { id: 'btn-magnet-copy', text: shouldDownloadMagnets ? 'Download' : 'Copy' })}
        ${renderButton('reinsert', { id: 'btn-reinsert-rd' })}
		${rdKey ? renderButton('castAll', { id: 'btn-cast-all' }) : ''}
		${
			info.links.length > 0
				? renderButton('downloadAll', {
						link: 'https://real-debrid.com/downloader',
						linkParam: { name: 'links', value: downloadAllLinksParam },
						id: 'btn-download-all',
					})
				: ''
		}
        ${info.links.length > 0 ? renderButton('exportLinks', { id: 'btn-export-links' }) : ''}
        ${info.links.length > 0 ? renderButton('generateStrm', { id: 'btn-generate-strm' }) : ''}
    </div>`
		: '';

	let html = `<h1 class="text-lg font-bold mt-3 mb-2 text-gray-100">${info.filename}</h1>
    ${libraryActions}
    <hr class="border-gray-600"/>
    <div class="text-sm max-h-60 mb-2 text-left p-1 bg-gray-900">
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
				return `
                <div class="m-2 text-center">
                    <div class="mb-2 flex flex-wrap items-center justify-center gap-2 rounded border border-cyan-500/40 bg-gray-900 px-2 py-1 text-sm font-semibold text-cyan-200">
						<span id="selection-count">
                        	${info.files.filter((f: ApiTorrentFile) => f.selected === 1).length}/${info.files.length} files selected
						</span>
						<button id="btn-toggle-selection"
							class="px-2 bg-gradient-to-r from-gray-600 to-gray-500 hover:from-gray-500 hover:to-gray-400 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
							title="Toggle selection"
						>
							<span class="inline-flex items-center">${icons.unselectAll}<span class="hidden sm:inline ml-1">Unselect All</span></span>
						</button>
                        <button id="btn-only-videos"
                            class="px-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
                            title="Only Videos"
                        >
                            <span class="inline-flex items-center">${icons.selectVideos}<span class="hidden sm:inline ml-1">Only Videos</span></span>
                        </button>
						<button id="btn-reset-selection"
                            class="px-2 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white font-medium rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98]"
                            title="Reset Selection"
                        >
                            <span class="inline-flex items-center">${icons.reset}<span class="hidden sm:inline ml-1">Reset</span></span>
                        </button>
						<button id="btn-save-selection"
                            class="px-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-sm shadow-lg transition-all duration-200 ease-in-out transform hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
                            title="Save File Selection"
                        >
                            <span class="inline-flex items-center">${icons.saveSelection}<span class="hidden sm:inline ml-1">Save</span></span>
                        </button>
                    </div>
                </div>
            `;
			})()
		: '';

	const originalFilenameRow = info.original_filename
		? [
				{
					label: 'Original filename',
					value: searchAgainButton
						? `<span class="mr-2">${info.original_filename}</span>${searchAgainButton}`
						: info.original_filename,
				},
			]
		: [];

	const infoRows = info.fake
		? [
				{ label: 'Size', value: (info.bytes / 1024 ** 3).toFixed(2) + ' GB' },
				...originalFilenameRow,
				...getStreamInfo(mediaInfo),
			]
		: [
				{ label: 'Size', value: (info.bytes / 1024 ** 3).toFixed(2) + ' GB' },
				{ label: 'ID', value: info.id },
				...originalFilenameRow,
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
				{
					label: 'Added',
					value: new Date(info.added).toLocaleString(undefined, { timeZone: 'UTC' }),
				},
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

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
		didOpen: () => {
			const logAction = (event: string, data: Record<string, unknown> = {}) => {
				console.log('[torrentModal]', event, data);
			};
			bindWatchButtons({
				service: 'rd',
				hash: info.hash,
				player: app ?? '',
				keys: { rdKey },
			});
			// Selection helpers
			const checkboxes = () =>
				Array.from(document.querySelectorAll<HTMLInputElement>('.file-selector'));
			const initialSelection: Record<string, boolean> = {};
			info.files.forEach((f: ApiTorrentFile) => (initialSelection[f.id] = f.selected === 1));
			const saveSelectionBtn = document.getElementById(
				'btn-save-selection'
			) as HTMLButtonElement | null;
			const updateSelectionState = () => {
				const total = checkboxes().length;
				const checked = checkboxes().filter((cb) => cb.checked).length;
				const hasChanged = checkboxes().some((cb) => {
					const fileId = cb.dataset.fileId;
					const initiallyChecked = fileId ? !!initialSelection[fileId] : false;
					return cb.checked !== initiallyChecked;
				});
				const el = document.getElementById('selection-count');
				if (el) el.textContent = `${checked}/${total} files selected`;
				const toggleBtn = document.getElementById(
					'btn-toggle-selection'
				) as HTMLButtonElement | null;
				if (toggleBtn) {
					const isUnselect = checked === total && total > 0;
					toggleBtn.title = isUnselect ? 'Unselect All' : 'Select All';
					toggleBtn.innerHTML = `<span class="inline-flex items-center">${isUnselect ? icons.unselectAll : icons.selectAll}<span class="hidden sm:inline ml-1">${isUnselect ? 'Unselect All' : 'Select All'}</span></span>`;
				}
				const resetBtn = document.getElementById(
					'btn-reset-selection'
				) as HTMLButtonElement | null;
				if (saveSelectionBtn) {
					const canSave = hasChanged && checked > 0;
					saveSelectionBtn.hidden = !canSave;
					saveSelectionBtn.disabled = !canSave;
					saveSelectionBtn.classList.toggle('opacity-50', !canSave);
					saveSelectionBtn.classList.toggle('pointer-events-none', !canSave);
				}
				if (resetBtn) {
					resetBtn.hidden = !hasChanged;
					resetBtn.disabled = !hasChanged;
					resetBtn.classList.toggle('opacity-50', !hasChanged);
					resetBtn.classList.toggle('pointer-events-none', !hasChanged);
				}
			};
			checkboxes().forEach((cb) => cb.addEventListener('change', updateSelectionState));
			const unselectAll = () => {
				checkboxes().forEach((cb) => (cb.checked = false));
			};
			const selectAll = () => {
				checkboxes().forEach((cb) => (cb.checked = true));
			};

			const onlyVideosBtn = document.getElementById('btn-only-videos');
			logAction('binding only-videos button (RD)', {
				exists: Boolean(onlyVideosBtn),
				hash: info.hash,
			});
			onlyVideosBtn?.addEventListener('click', () => {
				logAction('only-videos clicked (RD)', {
					hash: info.hash,
				});
				unselectAll();
				checkboxes().forEach((cb) => {
					const filePath = cb.dataset.filePath;
					if (filePath && isVideo({ path: filePath })) cb.checked = true;
				});
				updateSelectionState();
			});

			const toggleSelectionBtn = document.getElementById('btn-toggle-selection');
			logAction('binding toggle-selection button (RD)', {
				exists: Boolean(toggleSelectionBtn),
				hash: info.hash,
			});
			toggleSelectionBtn?.addEventListener('click', () => {
				const total = checkboxes().length;
				const checked = checkboxes().filter((cb) => cb.checked).length;
				const shouldSelectAll = checked !== total;
				logAction('toggle-selection clicked (RD)', {
					hash: info.hash,
					checked,
					total,
					action: shouldSelectAll ? 'select-all' : 'unselect-all',
				});
				if (shouldSelectAll) {
					selectAll();
				} else {
					unselectAll();
				}
				updateSelectionState();
			});

			updateSelectionState();

			const resetSelectionBtn = document.getElementById('btn-reset-selection');
			logAction('binding reset-selection button (RD)', {
				exists: Boolean(resetSelectionBtn),
				hash: info.hash,
			});
			resetSelectionBtn?.addEventListener('click', () => {
				logAction('reset-selection clicked (RD)', {
					hash: info.hash,
				});
				checkboxes().forEach((cb) => {
					const fileId = cb.dataset.fileId;
					cb.checked = fileId ? !!initialSelection[fileId] : false;
				});
				updateSelectionState();
			});

			logAction('binding save-selection button (RD)', {
				exists: Boolean(saveSelectionBtn),
				hash: info.hash,
			});
			saveSelectionBtn?.addEventListener('click', async () => {
				const selectedIds = checkboxes()
					.filter((cb) => cb.checked)
					.map((cb) => cb.dataset.fileId!)
					.filter(Boolean);
				logAction('save-selection clicked (RD)', {
					hash: info.hash,
					selectedIds,
				});
				const usedHandler = Boolean(handlers.onReinsertRd);
				try {
					if (handlers.onReinsertRd) {
						await handlers.onReinsertRd(
							rdKey,
							{ id: `rd:${info.id}`, hash: info.hash },
							true,
							selectedIds
						);
					} else {
						const oldId = `rd:${info.id}`;
						const newId = await addHashAsMagnet(rdKey, info.hash);
						await selectFiles(rdKey, newId, selectedIds);
						await handleDeleteRdTorrent(rdKey, oldId, true);
						toast.success('Selection saved and reinserted.', magnetToastOptions);
					}
					logAction('save-selection completed (RD)', {
						hash: info.hash,
						selectedIdsCount: selectedIds.length,
						usedHandler,
					});
					if (!usedHandler && handlers.onRefreshRd) await handlers.onRefreshRd(2);
					Modal.close();
				} catch (error) {
					logAction('save-selection failed (RD)', {
						hash: info.hash,
						error: error instanceof Error ? error.message : String(error),
					});
					toast.error(
						'Failed to save selection: ' +
							(error instanceof Error ? error.message : String(error)),
						magnetToastOptions
					);
				}
			});

			const magnetBtn = document.getElementById('btn-magnet-copy');
			logAction('binding magnet button (RD)', {
				exists: Boolean(magnetBtn),
				hash: info.hash,
				shouldDownloadMagnets,
			});
			magnetBtn?.addEventListener('click', () => {
				logAction('magnet button clicked (RD)', {
					hash: info.hash,
					shouldDownloadMagnets,
				});
				void handleCopyOrDownloadMagnet(info.hash, shouldDownloadMagnets);
			});

			const downloadAllBtn = document.getElementById('btn-download-all');
			logAction('binding download-all button (RD)', {
				exists: Boolean(downloadAllBtn),
				hash: info.hash,
				linkCount: info.links.length,
			});
			downloadAllBtn?.addEventListener('click', () => {
				logAction('download-all submitted (RD)', {
					hash: info.hash,
					linkCount: info.links.length,
				});
			});

			const deleteBtn = document.getElementById('btn-delete-rd');
			logAction('binding delete button (RD)', {
				exists: Boolean(deleteBtn),
				hash: info.hash,
			});
			deleteBtn?.addEventListener('click', async () => {
				logAction('delete clicked (RD)', {
					usingHandler: Boolean(handlers.onDeleteRd),
					id: `rd:${info.id}`,
				});
				try {
					if (handlers.onDeleteRd) {
						await handlers.onDeleteRd(rdKey, `rd:${info.id}`);
					} else {
						await handleDeleteRdTorrent(rdKey, `rd:${info.id}`);
					}
					logAction('delete completed (RD)', {
						id: `rd:${info.id}`,
					});
					Modal.close();
				} catch (error) {
					logAction('delete failed (RD)', {
						id: `rd:${info.id}`,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});

			const reinsertBtn = document.getElementById('btn-reinsert-rd');
			logAction('binding reinsert button (RD)', {
				exists: Boolean(reinsertBtn),
				hash: info.hash,
			});
			reinsertBtn?.addEventListener('click', async () => {
				const selectedIds = checkboxes()
					.filter((cb) => cb.checked)
					.map((cb) => cb.dataset.fileId!)
					.filter(Boolean);
				logAction('reinsert clicked (RD)', {
					hash: info.hash,
					selectedIds,
				});
				const usedHandler = Boolean(handlers.onReinsertRd);
				try {
					if (handlers.onReinsertRd) {
						await handlers.onReinsertRd(
							rdKey,
							{ id: `rd:${info.id}`, hash: info.hash },
							true,
							selectedIds
						);
					} else {
						const oldId = `rd:${info.id}`;
						const newId = await addHashAsMagnet(rdKey, info.hash);
						await selectFiles(rdKey, newId, selectedIds);
						await handleDeleteRdTorrent(rdKey, oldId, true);
						toast.success('Selection saved and reinserted.', magnetToastOptions);
					}
					logAction('reinsert completed (RD)', {
						hash: info.hash,
						selectedIdsCount: selectedIds.length,
						newSelection: selectedIds,
						usedHandler,
					});
					if (!usedHandler && handlers.onRefreshRd) await handlers.onRefreshRd(2);
					Modal.close();
				} catch (error: any) {
					logAction('reinsert failed (RD)', {
						hash: info.hash,
						error: error?.message || error,
					});
					toast.error(
						'Failed to save selection: ' + (error?.message || error),
						magnetToastOptions
					);
				}
			});

			const exportBtn = document.getElementById('btn-export-links');
			logAction('binding export-links button (RD)', {
				exists: Boolean(exportBtn),
				hash: info.hash,
				linkCount: info.links.length,
			});
			exportBtn?.addEventListener('click', async () => {
				logAction('export-links clicked (RD)', {
					hash: info.hash,
					linkCount: info.links.length,
				});
				if (!info.links?.length) {
					toast.error('No links to export.', magnetToastOptions);
					return;
				}
				const toastId = toast.loading('Preparing download links...', magnetToastOptions);
				try {
					const lines: string[] = [];
					for (const link of info.links as string[]) {
						try {
							const resp = await proxyUnrestrictLink(rdKey, link);
							lines.push(resp.download);
						} catch (e) {
							console.error(e);
						}
					}
					if (!lines.length) {
						toast.error('Failed to fetch unrestricted links.', magnetToastOptions);
						return;
					}
					const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = `${info.original_filename}.txt`;
					a.click();
					URL.revokeObjectURL(a.href);
					toast.success('Download links exported.', magnetToastOptions);
					logAction('export-links completed (RD)', {
						hash: info.hash,
						linesCount: lines.length,
					});
				} catch (e) {
					console.error(e);
					logAction('export-links failed (RD)', {
						hash: info.hash,
						error: e instanceof Error ? e.message : String(e),
					});
					const apiError = getRdError(e);
					toast.error(
						apiError ? `RD error: ${apiError}` : 'Failed to export download links.',
						magnetToastOptions
					);
				} finally {
					toast.dismiss(toastId);
				}
			});

			const generateStrmBtn = document.getElementById('btn-generate-strm');
			logAction('binding generate-strm button (RD)', {
				exists: Boolean(generateStrmBtn),
				hash: info.hash,
				linkCount: info.links.length,
			});
			generateStrmBtn?.addEventListener('click', async () => {
				logAction('generate-strm clicked (RD)', {
					hash: info.hash,
					linkCount: info.links.length,
				});
				if (!info.links?.length) {
					toast.error('No links for STRM files.', magnetToastOptions);
					return;
				}
				const toastId = toast.loading('Generating STRM files...', magnetToastOptions);
				let generated = 0;
				try {
					for (const link of info.links as string[]) {
						try {
							const resp = await proxyUnrestrictLink(rdKey, link);
							const nameWithoutExt = resp.filename.substring(
								0,
								resp.filename.lastIndexOf('.')
							);
							const strmName = resp.streamable
								? `${nameWithoutExt}.strm`
								: `${resp.filename}.strm`;
							const blob = new Blob([resp.download], { type: 'text/plain' });
							const a = document.createElement('a');
							a.href = URL.createObjectURL(blob);
							a.download = strmName;
							a.click();
							URL.revokeObjectURL(a.href);
							generated += 1;
						} catch (e) {
							console.error(e);
						}
					}
					if (generated) {
						toast.success(
							`Generated ${generated} STRM file${generated === 1 ? '' : 's'}.`,
							magnetToastOptions
						);
					} else {
						toast.error('Failed to generate STRM files.', magnetToastOptions);
					}
					logAction('generate-strm completed (RD)', {
						hash: info.hash,
						generated,
					});
				} catch (e) {
					console.error(e);
					logAction('generate-strm failed (RD)', {
						hash: info.hash,
						error: e instanceof Error ? e.message : String(e),
					});
					const apiError = getRdError(e);
					toast.error(
						apiError ? `RD error: ${apiError}` : 'Failed to generate STRM files.',
						magnetToastOptions
					);
				} finally {
					toast.dismiss(toastId);
				}
			});

			bindCastAllButton({
				buttonId: 'btn-cast-all',
				castUrl: `/api/stremio/cast/library/${info.id}:${info.hash}`,
				apiKey: rdKey,
				filename: info.filename,
				log: logAction,
			});
		},
	});
};

export const showInfoForAD = async (
	app: string,
	adKey: string,
	info: any,
	imdbId: string = '',
	shouldDownloadMagnets?: boolean,
	handlers: ShowInfoHandlers = {}
): Promise<void> => {
	Modal.showLoading();
	const mediaInfo = await fetchMediaInfo(info.hash);
	const torrent = {
		id: `ad:${info.id}`,
		hash: info.hash,
		filename: info.filename,
		bytes: info.size,
		title: info.filename,
		mediaType: 'other',
	};

	const downloadAllLink = `https://alldebrid.com/service/?url=${info.links.map((l: MagnetLink) => encodeURIComponent(l.link)).join('%0D%0A')}`;
	// A fake magnet is assembled from a search result: it has no AllDebrid id to
	// delete or reinsert, and no links to export.
	const libraryActions = !info.fake
		? `
        <div class="mb-3 flex justify-center items-center flex-wrap">
            ${renderButton('share', { link: `${await handleShare(torrent)}` })}
            ${renderButton('delete', { id: 'btn-delete-ad' })}
            ${renderButton('magnet', { id: 'btn-magnet-copy', text: shouldDownloadMagnets ? 'Download' : 'Copy' })}
            ${renderButton('reinsert', { id: 'btn-restart-ad' })}
            ${adKey ? renderButton('castAll', { id: 'btn-cast-all' }) : ''}
	            ${info.links.length > 1 ? renderButton('downloadAll', { link: `${downloadAllLink}`, id: 'btn-download-all-ad' }) : ''}
            ${info.links.length > 0 ? renderButton('exportLinks', { id: 'btn-export-links' }) : ''}
            ${info.links.length > 0 ? renderButton('generateStrm', { id: 'btn-generate-strm' }) : ''}
        </div>`
		: '';

	const allInfoRows = info.fake
		? [
				{ label: 'Size', value: (info.size / 1024 ** 3).toFixed(2) + ' GB' },
				...getStreamInfo(mediaInfo),
			]
		: [
				{ label: 'Size', value: (info.size / 1024 ** 3).toFixed(2) + ' GB' },
				{ label: 'ID', value: info.id },
				{ label: 'Status', value: `${info.status} (code: ${info.statusCode})` },
				{
					label: 'Added',
					value: new Date(info.uploadDate * 1000).toLocaleString(undefined, {
						timeZone: 'UTC',
					}),
				},
				...getStreamInfo(mediaInfo),
			];

	const html = `<h1 class="text-lg font-bold mt-3 mb-2 text-gray-100">${info.filename}</h1>
    ${libraryActions}
    <div class="text-sm text-gray-200">
        ${renderInfoTable(allInfoRows)}
    </div>
    <div class="text-sm max-h-60 mb-2 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfo(info, false, adKey, app, imdbId)}
                </tbody>
            </table>
        </div>
    </div>`;

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
		didOpen: () => {
			const logAction = (event: string, data: Record<string, unknown> = {}) => {
				console.log('[torrentModal]', event, data);
			};
			bindCastAllButton({
				buttonId: 'btn-cast-all',
				castUrl: `/api/stremio-ad/cast/library/${info.id}:${info.hash}`,
				apiKey: adKey,
				filename: info.filename,
				log: logAction,
			});
			bindWatchButtons({
				service: 'ad',
				hash: info.hash,
				player: app ?? '',
				keys: { adKey },
				// A magnet already in the user's library must survive the watch;
				// only one prepared for a search result gets cleaned up again. A
				// search result can be in the library too - the upload dedupes onto
				// it - so the caller's own check has to be honoured here.
				adInLibrary: !info.fake || Boolean(info.adInLibrary),
			});
			const magnetBtn = document.getElementById('btn-magnet-copy');
			logAction('binding magnet button (AD)', {
				exists: Boolean(magnetBtn),
				hash: info.hash,
				shouldDownloadMagnets,
			});
			magnetBtn?.addEventListener('click', () => {
				logAction('magnet button clicked (AD)', {
					hash: info.hash,
					shouldDownloadMagnets,
				});
				void handleCopyOrDownloadMagnet(info.hash, shouldDownloadMagnets);
			});

			const downloadAllBtn = document.getElementById('btn-download-all-ad');
			logAction('binding download-all button (AD)', {
				exists: Boolean(downloadAllBtn),
				hash: info.hash,
				linkCount: info.links.length,
			});
			downloadAllBtn?.addEventListener('click', () => {
				logAction('download-all submitted (AD)', {
					hash: info.hash,
					linkCount: info.links.length,
				});
			});

			const deleteBtn = document.getElementById('btn-delete-ad');
			logAction('binding delete button (AD)', {
				exists: Boolean(deleteBtn),
				hash: info.hash,
			});
			deleteBtn?.addEventListener('click', async () => {
				logAction('delete clicked (AD)', {
					usingHandler: Boolean(handlers.onDeleteAd),
					id: `ad:${info.id}`,
				});
				try {
					if (handlers.onDeleteAd) {
						await handlers.onDeleteAd(adKey, `ad:${info.id}`);
					} else {
						await handleDeleteAdTorrent(adKey, `ad:${info.id}`);
					}
					logAction('delete completed (AD)', {
						id: `ad:${info.id}`,
					});
					Modal.close();
				} catch (error) {
					logAction('delete failed (AD)', {
						id: `ad:${info.id}`,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});

			const restartBtn = document.getElementById('btn-restart-ad');
			logAction('binding restart button (AD)', {
				exists: Boolean(restartBtn),
				hash: info.hash,
			});
			restartBtn?.addEventListener('click', async () => {
				logAction('restart clicked (AD)', {
					hash: info.hash,
				});
				if (handlers.onRestartAd) {
					await handlers.onRestartAd(adKey, `${info.id}`);
				} else {
					await handleRestartTorrent(adKey, `${info.id}`);
				}
				logAction('restart completed (AD)', {
					hash: info.hash,
				});
				Modal.close();
			});

			const exportBtn = document.getElementById('btn-export-links');
			logAction('binding export-links button (AD)', {
				exists: Boolean(exportBtn),
				hash: info.hash,
				linkCount: info.links.length,
			});
			exportBtn?.addEventListener('click', async () => {
				logAction('export-links clicked (AD)', {
					hash: info.hash,
					linkCount: info.links.length,
				});
				if (!info.links?.length) {
					toast.error('No links to export.', magnetToastOptions);
					return;
				}
				try {
					const textContent = (info.links as MagnetLink[]).map((l) => l.link).join('\n');
					const blob = new Blob([textContent], { type: 'text/plain' });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = `${info.filename}.txt`;
					a.click();
					URL.revokeObjectURL(a.href);
					toast.success('Links exported.', magnetToastOptions);
					logAction('export-links completed (AD)', {
						hash: info.hash,
						linesCount: info.links.length,
					});
				} catch (e) {
					console.error(e);
					logAction('export-links failed (AD)', {
						hash: info.hash,
						error: e instanceof Error ? e.message : String(e),
					});
					const apiError = getAdError(e);
					toast.error(
						apiError ? `AD error: ${apiError}` : 'Failed to export links.',
						magnetToastOptions
					);
				}
			});

			const generateStrmBtn = document.getElementById('btn-generate-strm');
			logAction('binding generate-strm button (AD)', {
				exists: Boolean(generateStrmBtn),
				hash: info.hash,
				linkCount: info.links.length,
			});
			generateStrmBtn?.addEventListener('click', async () => {
				logAction('generate-strm clicked (AD)', {
					hash: info.hash,
					linkCount: info.links.length,
				});
				if (!info.links?.length) {
					toast.error('No files for STRM generation.', magnetToastOptions);
					return;
				}
				let generated = 0;
				try {
					for (const file of info.links as MagnetLink[]) {
						const blob = new Blob([file.link], { type: 'text/plain' });
						const a = document.createElement('a');
						const base = file.filename?.replace(/\.[^/.]+$/, '') || info.filename;
						a.href = URL.createObjectURL(blob);
						a.download = `${base}.strm`;
						a.click();
						URL.revokeObjectURL(a.href);
						generated += 1;
					}
					toast.success(
						`Generated ${generated} STRM file${generated === 1 ? '' : 's'}.`,
						magnetToastOptions
					);
					logAction('generate-strm completed (AD)', {
						hash: info.hash,
						generated,
					});
				} catch (e) {
					console.error(e);
					logAction('generate-strm failed (AD)', {
						hash: info.hash,
						error: e instanceof Error ? e.message : String(e),
					});
					const apiError = getAdError(e);
					toast.error(
						apiError ? `AD error: ${apiError}` : 'Failed to generate STRM files.',
						magnetToastOptions
					);
				}
			});
		},
	});
};

export const showInfoForTB = async (
	app: string,
	tbKey: string,
	info: TorBoxTorrentInfo,
	shouldDownloadMagnets?: boolean,
	handlers: {
		onDeleteTb?: (tbKey: string, id: string) => Promise<void>;
	} = {},
	// A web download has no magnet and no shareable infohash, and its links come
	// from TorBox's separate webdl endpoint.
	isWebDownload = false
): Promise<void> => {
	Modal.showLoading();
	const rowId = isWebDownload ? toWebDownloadRowId(info.id) : `tb:${info.id}`;
	const mediaInfo = isWebDownload ? null : await fetchMediaInfo(info.hash);
	const torrent = {
		id: rowId,
		hash: info.hash,
		filename: info.name,
		bytes: info.size,
		title: info.name,
		mediaType: 'other' as const,
	};

	const libraryActions = `
        <div class="mb-3 flex justify-center items-center flex-wrap">
            ${isWebDownload ? '' : renderButton('share', { link: `${await handleShare(torrent)}` })}
            ${renderButton('delete', { id: 'btn-delete-tb' })}
            ${tbKey ? renderButton('castAll', { id: 'btn-cast-all' }) : ''}
            ${isWebDownload ? '' : renderButton('magnet', { id: 'btn-magnet-copy', text: shouldDownloadMagnets ? 'Download' : 'Copy' })}
            ${info.files?.length ? renderButton('exportLinks', { id: 'btn-export-links' }) : ''}
        </div>`;

	const files = info.files ?? [];

	const statusLabel = info.download_finished
		? 'Downloaded'
		: info.download_state.charAt(0).toUpperCase() + info.download_state.slice(1);

	const infoRows = [
		{ label: 'Size', value: (info.size / 1024 ** 3).toFixed(2) + ' GB' },
		{ label: 'ID', value: info.id },
		...(isWebDownload ? [{ label: 'Source', value: 'Web download' }] : []),
		{ label: 'Status', value: statusLabel },
		...(info.download_state === 'downloading'
			? [
					{ label: 'Progress', value: info.progress.toFixed(2) + '%' },
					{ label: 'Speed', value: (info.download_speed / 1024).toFixed(2) + ' KB/s' },
					...(isWebDownload ? [] : [{ label: 'Seeds', value: info.seeds }]),
				]
			: []),
		{
			label: 'Added',
			value: new Date(info.created_at).toLocaleString(undefined, { timeZone: 'UTC' }),
		},
		...getStreamInfo(mediaInfo),
	];

	const html = `<h1 class="text-lg font-bold mt-3 mb-2 text-gray-100">${info.name}</h1>
    ${libraryActions}
    <div class="text-sm text-gray-200">
        ${renderInfoTable(infoRows)}
    </div>
    <div class="text-sm max-h-60 mb-2 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfoTB(files, {
						tbKey,
						app,
						hash: info.hash,
					})}
                </tbody>
            </table>
        </div>
    </div>`;

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
		didOpen: () => {
			const logAction = (event: string, data: Record<string, unknown> = {}) => {
				console.log('[torrentModal]', event, data);
			};
			bindCastAllButton({
				buttonId: 'btn-cast-all',
				// A web download lives in its own TorBox table, named by a `w` prefix.
				castUrl: `/api/stremio-tb/cast/library/${isWebDownload ? 'w' : ''}${info.id}:${info.hash}`,
				apiKey: tbKey,
				filename: info.name,
				log: logAction,
			});
			bindWatchButtons({
				service: isWebDownload ? 'tbw' : 'tb',
				hash: info.hash,
				player: app ?? '',
				keys: { torboxKey: tbKey },
			});
			const magnetBtn = document.getElementById('btn-magnet-copy');
			logAction('binding magnet button (TB)', {
				exists: Boolean(magnetBtn),
				hash: info.hash,
				shouldDownloadMagnets,
			});
			magnetBtn?.addEventListener('click', () => {
				logAction('magnet button clicked (TB)', { hash: info.hash });
				void handleCopyOrDownloadMagnet(info.hash, shouldDownloadMagnets);
			});

			const deleteBtn = document.getElementById('btn-delete-tb');
			logAction('binding delete button (TB)', {
				exists: Boolean(deleteBtn),
				hash: info.hash,
			});
			deleteBtn?.addEventListener('click', async () => {
				logAction('delete clicked (TB)', {
					usingHandler: Boolean(handlers.onDeleteTb),
					id: rowId,
				});
				try {
					if (handlers.onDeleteTb) {
						await handlers.onDeleteTb(tbKey, rowId);
					} else {
						await handleDeleteTbTorrent(tbKey, rowId);
					}
					logAction('delete completed (TB)', { id: rowId });
					Modal.close();
				} catch (error) {
					logAction('delete failed (TB)', {
						id: rowId,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});

			const exportBtn = document.getElementById('btn-export-links');
			logAction('binding export-links button (TB)', {
				exists: Boolean(exportBtn),
				hash: info.hash,
				fileCount: files.length,
			});
			exportBtn?.addEventListener('click', async () => {
				logAction('export-links clicked (TB)', { hash: info.hash });
				if (!files.length) {
					toast.error('No files to export.', magnetToastOptions);
					return;
				}
				const toastId = toast.loading('Fetching download links...', magnetToastOptions);
				try {
					const lines: string[] = [];
					for (const file of files) {
						try {
							const resp = isWebDownload
								? await requestWebDownloadLink(tbKey, {
										web_id: info.id,
										file_id: file.id,
									})
								: await requestDownloadLink(tbKey, {
										torrent_id: info.id,
										file_id: file.id,
									});
							if (resp.data) lines.push(resp.data);
						} catch (e) {
							console.error('Failed to get link for file', file.name, e);
						}
					}
					if (!lines.length) {
						toast.error('Failed to fetch download links.', magnetToastOptions);
						return;
					}
					const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = `${info.name}.txt`;
					a.click();
					URL.revokeObjectURL(a.href);
					toast.success('Download links exported.', magnetToastOptions);
					logAction('export-links completed (TB)', {
						hash: info.hash,
						linesCount: lines.length,
					});
				} catch (e) {
					console.error(e);
					logAction('export-links failed (TB)', {
						hash: info.hash,
						error: e instanceof Error ? e.message : String(e),
					});
					toast.error('Failed to export download links.', magnetToastOptions);
				} finally {
					toast.dismiss(toastId);
				}
			});
		},
	});
};

/**
 * Info modal for a Premiumize library item.
 *
 * Premiumize links expire and cost nothing to re-mint, so none are stored on the
 * row: every per-file link here is resolved on the click that needs it. That
 * also makes this the one modal that works for content whose transfer record is
 * gone, because `item/details` is keyed on the file id rather than the hash.
 */
export const showInfoForPM = async (
	app: string,
	pmKey: string,
	torrent: {
		id: string;
		hash: string;
		filename: string;
		title: string;
		bytes: number;
		serviceStatus: string;
		progress: number;
		added: Date;
		selectedFiles: any[];
	},
	shouldDownloadMagnets?: boolean,
	handlers: { onDeletePm?: (pmKey: string, id: string) => Promise<void> } = {}
): Promise<void> => {
	// A row whose transfer has been cleared has no info hash at all, so the
	// magnet-shaped actions have nothing to act on.
	const hasInfoHash = /^[a-fA-F0-9]{40}$/.test(torrent.hash);
	const files: PremiumizeFileRow[] = (torrent.selectedFiles ?? [])
		.filter((file) => typeof file?.fileId === 'string')
		.map((file) => ({
			fileId: file.fileId as string,
			filename: file.filename as string,
			filesize: Number(file.filesize) || 0,
		}));

	const libraryActions = `
        <div class="mb-3 flex justify-center items-center flex-wrap">
            ${hasInfoHash ? renderButton('share', { link: `${await handleShare(torrent)}` }) : ''}
            ${renderButton('delete', { id: 'btn-delete-pm' })}
            ${hasInfoHash ? renderButton('castAll', { id: 'btn-cast-all' }) : ''}
            ${hasInfoHash ? renderButton('magnet', { id: 'btn-magnet-copy', text: shouldDownloadMagnets ? 'Download' : 'Copy' }) : ''}
            ${files.length ? renderButton('exportLinks', { id: 'btn-export-links' }) : ''}
        </div>`;

	const infoRows = [
		{ label: 'Size', value: (torrent.bytes / 1024 ** 3).toFixed(2) + ' GB' },
		{ label: 'ID', value: torrent.id },
		{ label: 'Status', value: getPremiumizeStatusText(torrent.serviceStatus) },
		...(torrent.progress < 100 ? [{ label: 'Progress', value: torrent.progress + '%' }] : []),
		...(hasInfoHash ? [] : [{ label: 'Info hash', value: 'not reported by Premiumize' }]),
		{
			label: 'Added',
			value: new Date(torrent.added).toLocaleString(undefined, { timeZone: 'UTC' }),
		},
	];

	const html = `<h1 class="text-lg font-bold mt-3 mb-2 text-gray-100">${torrent.filename}</h1>
    ${libraryActions}
    <div class="text-sm text-gray-200">
        ${renderInfoTable(infoRows)}
    </div>
    <div class="text-sm max-h-60 mb-2 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfoPM(files, { canWatch: Boolean(app) && hasInfoHash })}
                </tbody>
            </table>
        </div>
    </div>`;

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
		didOpen: () => {
			bindWatchButtons({
				service: 'pm',
				hash: torrent.hash,
				player: app ?? '',
				keys: { premiumizeKey: pmKey },
			});

			// Only a row whose transfer record survives reports an info hash, and
			// the cast is resolved from that hash alone - see the route.
			if (hasInfoHash) {
				bindCastAllButton({
					buttonId: 'btn-cast-all',
					castUrl: `/api/stremio-pm/cast/library/${torrent.hash}`,
					apiKey: pmKey,
					filename: torrent.filename,
				});
			}

			document
				.querySelectorAll<HTMLButtonElement>('button[data-pm-file-id]')
				.forEach((button) => {
					button.addEventListener('click', async () => {
						if (button.disabled) return;
						button.disabled = true;
						try {
							const details = await getPremiumizeItemDetails(
								pmKey,
								button.dataset.pmFileId!
							);
							const link = details.stream_link || details.link;
							if (!link) {
								toast.error('Premiumize returned no link.', magnetToastOptions);
								return;
							}
							window.open(link, '_blank');
						} catch (error) {
							toast.error(
								`Premiumize error: ${error instanceof Error ? error.message : 'link failed'}`,
								magnetToastOptions
							);
						} finally {
							button.disabled = false;
						}
					});
				});

			document.getElementById('btn-magnet-copy')?.addEventListener('click', () => {
				void handleCopyOrDownloadMagnet(torrent.hash, shouldDownloadMagnets);
			});

			document.getElementById('btn-delete-pm')?.addEventListener('click', async () => {
				try {
					if (handlers.onDeletePm) await handlers.onDeletePm(pmKey, torrent.id);
					else await handleDeletePmTorrent(pmKey, torrent.id);
					Modal.close();
				} catch (error) {
					console.error('[torrentModal] delete failed (PM)', error);
				}
			});

			document.getElementById('btn-export-links')?.addEventListener('click', async () => {
				const toastId = toast.loading('Fetching download links...', magnetToastOptions);
				try {
					const lines: string[] = [];
					for (const file of files) {
						try {
							const details = await getPremiumizeItemDetails(pmKey, file.fileId);
							if (details.link) lines.push(details.link);
						} catch (error) {
							console.error('Failed to get link for file', file.filename, error);
						}
					}
					if (!lines.length) {
						toast.error('Failed to fetch download links.', {
							...magnetToastOptions,
							id: toastId,
						});
						return;
					}
					const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = `${torrent.filename}.txt`;
					a.click();
					URL.revokeObjectURL(a.href);
					toast.success('Download links exported.', {
						...magnetToastOptions,
						id: toastId,
					});
				} catch (error) {
					toast.error('Failed to export download links.', {
						...magnetToastOptions,
						id: toastId,
					});
				}
			});
		},
	});
};

/**
 * Info modal for an Offcloud library item.
 *
 * Three measured Offcloud behaviours decide what this does
 * (`docs/providers/offcloud.md`):
 *
 *  - **The library listing carries no files and no sizes.** `cloud/history` is
 *    all the library fetch gets, so the listing is assembled here, on open:
 *    `cloud/explore` for the signed links and `cache/info` for the names and
 *    byte sizes, joined on the filename. Two requests for the one row a user
 *    actually looked at.
 *  - **A garbage magnet becomes a zombie.** Offcloud accepts an invalid magnet
 *    with a 200 and parks it in `created` / "Loading..." indefinitely - nothing
 *    upstream ever finishes or fails it. An unfinished row is therefore polled
 *    once for a fresher status, and one still sitting in `created` is offered
 *    an explicit way out rather than left to occupy the library forever.
 *  - **The links are already playable.** Keyless, any IP, Range honoured - the
 *    same energycdn objects Premiumize serves. Nothing has to be unrestricted,
 *    so both Watch and DL work straight off the explore URL, and neither needs
 *    the info hash a plain-HTTP row does not have.
 */
export const showInfoForOC = async (
	app: string,
	ocKey: string,
	torrent: {
		id: string;
		hash: string;
		filename: string;
		title: string;
		bytes: number;
		serviceStatus: string;
		progress: number;
		added: Date;
	},
	shouldDownloadMagnets?: boolean,
	handlers: { onDeleteOc?: (ocKey: string, id: string) => Promise<void> } = {}
): Promise<void> => {
	const requestId = parseOffcloudRowId(torrent.id);
	if (!requestId) {
		toast.error(`Unrecognised Offcloud row ${torrent.id}.`, magnetToastOptions);
		return;
	}

	// An Offcloud row built from a plain HTTP submission has no info hash, and
	// one recovered from `originalLink` is the 40-char hex form.
	const hasInfoHash = /^[a-fA-F0-9]{40}$/.test(torrent.hash);

	Modal.showLoading();

	let serviceStatus = torrent.serviceStatus;
	let progress = torrent.progress;
	// One poll, not a loop: `cloud/status` takes a single requestId per call and
	// a zombie would never change however long it were watched.
	if (serviceStatus === 'created' || serviceStatus === 'queued') {
		try {
			const status = await getOffcloudCloudStatus(ocKey, requestId);
			serviceStatus = status.status;
			if (typeof status.progress === 'number') progress = status.progress;
		} catch (error) {
			console.error('[torrentModal] status poll failed (OC)', error);
		}
	}

	let files: OffcloudFile[] = [];
	if (serviceStatus === 'downloaded') {
		try {
			const links = await exploreOffcloudCloud(ocKey, requestId);
			// `cache/info` is where names and sizes come from, and it needs the
			// magnet form - a bare hash there silently reports cached content as
			// uncached. Without a hash the links still list, by basename alone.
			let cacheFiles: { folder: string; filename: string; size: number }[] = [];
			if (hasInfoHash) {
				try {
					const [info] = await getOffcloudCacheInfo(ocKey, [torrent.hash]);
					cacheFiles = info?.files ?? [];
				} catch (error) {
					console.error('[torrentModal] cache/info failed (OC)', error);
				}
			}
			files = joinExploreWithCacheInfo(links, cacheFiles);
		} catch (error) {
			console.error('[torrentModal] explore failed (OC)', error);
		}
	}

	const isStuck = serviceStatus === 'created';
	const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0) || torrent.bytes;

	const libraryActions = `
        <div class="mb-3 flex justify-center items-center flex-wrap">
            ${hasInfoHash ? renderButton('share', { link: `${await handleShare({ ...torrent, bytes: totalBytes })}` }) : ''}
            ${renderButton('delete', { id: 'btn-delete-oc' })}
            ${hasInfoHash ? renderButton('castAll', { id: 'btn-cast-all' }) : ''}
            ${hasInfoHash ? renderButton('magnet', { id: 'btn-magnet-copy-oc', text: shouldDownloadMagnets ? 'Download' : 'Copy' }) : ''}
            ${files.length ? renderButton('exportLinks', { id: 'btn-export-links-oc' }) : ''}
        </div>`;

	const infoRows = [
		{ label: 'Size', value: (totalBytes / 1024 ** 3).toFixed(2) + ' GB' },
		{ label: 'ID', value: torrent.id },
		{ label: 'Status', value: getOffcloudStatusText(serviceStatus) },
		...(serviceStatus !== 'downloaded' && progress > 0
			? [{ label: 'Progress', value: progress + '%' }]
			: []),
		...(hasInfoHash ? [] : [{ label: 'Info hash', value: 'not a torrent submission' }]),
		{
			label: 'Added',
			value: new Date(torrent.added).toLocaleString(undefined, { timeZone: 'UTC' }),
		},
	];

	// Offcloud never times a stuck item out, so the user is told what this state
	// means and given the one action that clears it.
	const stuckNotice = isStuck
		? `<div class="mb-2 rounded border border-amber-600 bg-amber-900/30 p-2 text-sm text-amber-100">
            Offcloud has not started this one. It accepts an unusable magnet without
            refusing it and then leaves it here indefinitely — removing it is the only
            way out.
            ${renderButton('delete', { id: 'btn-remove-stuck-oc', text: 'Remove stuck item' })}
        </div>`
		: '';

	const html = `<h1 class="text-lg font-bold mt-3 mb-2 text-gray-100">${torrent.filename}</h1>
    ${libraryActions}
    ${stuckNotice}
    <div class="text-sm text-gray-200">
        ${renderInfoTable(infoRows)}
    </div>
    <div class="text-sm max-h-60 mb-2 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfoOC(
						files.map((file) => ({
							link: file.link,
							filename: file.filename,
							filesize: file.size,
						})),
						{ canWatch: Boolean(app) }
					)}
                </tbody>
            </table>
        </div>
    </div>`;

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
		didOpen: () => {
			// Every Watch row carries its own already-playable link, so nothing
			// here has to resolve the hash - which a plain-HTTP row does not have.
			bindWatchButtons({
				service: 'oc',
				hash: torrent.hash,
				player: app ?? '',
				keys: { offcloudKey: ocKey },
			});

			// Offcloud resolves a cast from the info hash alone, so a row created
			// from a plain HTTP submission has nothing to cast. The request id
			// goes along so the route can fall back to `cloud/explore` for an
			// item this account holds but Offcloud's shared cache does not.
			if (hasInfoHash) {
				bindCastAllButton({
					buttonId: 'btn-cast-all',
					castUrl: `/api/stremio-oc/cast/library/${torrent.hash}?requestId=${encodeURIComponent(requestId)}`,
					apiKey: ocKey,
					filename: torrent.filename,
				});
			}

			document
				.querySelectorAll<HTMLButtonElement>('button[data-oc-link]')
				.forEach((button) => {
					button.addEventListener('click', () => {
						window.open(button.dataset.ocLink!, '_blank');
					});
				});

			document.getElementById('btn-magnet-copy-oc')?.addEventListener('click', () => {
				void handleCopyOrDownloadMagnet(torrent.hash, shouldDownloadMagnets);
			});

			const removeItem = async () => {
				try {
					if (handlers.onDeleteOc) await handlers.onDeleteOc(ocKey, torrent.id);
					else await handleDeleteOcTorrent(ocKey, torrent.id);
					Modal.close();
				} catch (error) {
					console.error('[torrentModal] delete failed (OC)', error);
				}
			};
			document.getElementById('btn-delete-oc')?.addEventListener('click', removeItem);
			document.getElementById('btn-remove-stuck-oc')?.addEventListener('click', removeItem);

			// The links are already minted and keyless, so this is a plain export
			// with no per-file request behind it - unlike Premiumize's.
			document.getElementById('btn-export-links-oc')?.addEventListener('click', () => {
				const blob = new Blob([files.map((file) => file.link).join('\n')], {
					type: 'text/plain',
				});
				const a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = `${torrent.filename}.txt`;
				a.click();
				URL.revokeObjectURL(a.href);
				toast.success('Download links exported.', magnetToastOptions);
			});
		},
	});
};

/**
 * Info modal for a Debrid-Link library item.
 *
 * Three measured Debrid-Link behaviours decide what this does
 * (`docs/providers/debrid-link.md`):
 *
 *  - **The files are fetched, not read off the row.** The library listing does
 *    carry them, but the per-file download URLs are deliberately not persisted
 *    (`convertToDlUserTorrent` says why: a keyless, IP-agnostic URL that keeps
 *    serving after the torrent is deleted has no business sitting in IndexedDB).
 *    One `seedbox/list` call by id rebuilds them for the row a user opened.
 *  - **That same call is the ZIP escape hatch.** A torrent with many files
 *    lists as a single `isZip: true` entry in the bulk listing and only expands
 *    when fetched on its own. The client sends both the `id` and `ids`
 *    parameters, because the endpoint's description spells the expanding one
 *    `id` while its parameter table lists only `ids` - and it matches the
 *    answer against the requested id afterwards either way, because an id
 *    Debrid-Link does not recognise makes the filter vanish and the *entire
 *    account* come back.
 *  - **The links are already playable.** No token, no signature, no IP binding
 *    - the torrent id is the whole capability - so Watch and DL both work
 *    straight off the URL and nothing has to be unrestricted.
 */
export const showInfoForDL = async (
	app: string,
	dlKey: string,
	torrent: {
		id: string;
		hash: string;
		filename: string;
		title: string;
		bytes: number;
		serviceStatus: string;
		progress: number;
		added: Date;
	},
	shouldDownloadMagnets?: boolean,
	handlers: { onDeleteDl?: (dlKey: string, id: string) => Promise<void> } = {}
): Promise<void> => {
	// Row ids are `dl:<torrentId>`, parsed inline for the same reason the delete
	// path parses inline: there is exactly one row shape.
	const torrentId = torrent.id.startsWith('dl:') ? torrent.id.slice(3) : '';
	if (!torrentId) {
		toast.error(`Unrecognised Debrid-Link row ${torrent.id}.`, magnetToastOptions);
		return;
	}

	Modal.showLoading();

	let files: DebridLinkFile[] = [];
	let serviceStatus = torrent.serviceStatus;
	let progress = torrent.progress;
	let totalBytes = torrent.bytes;
	let stillZipped = false;
	try {
		const fresh = await getSeedboxTorrent(dlKey, torrentId);
		if (fresh) {
			files = Array.isArray(fresh.files) ? fresh.files : [];
			serviceStatus = getDebridLinkServiceStatus(fresh);
			progress = fresh.downloadPercent ?? progress;
			totalBytes = fresh.totalSize ?? totalBytes;
			// A torrent that is still one ZIP entry after being fetched on its own
			// has not expanded, so the listing below is the archive rather than
			// its contents - say so instead of implying a one-file release.
			stillZipped = Boolean(fresh.isZip) && files.length <= 1;
		}
	} catch (error) {
		console.error('[torrentModal] fetch by id failed (DL)', error);
	}

	// Debrid-Link reports `hashString` on every seedbox row, so unlike Premiumize
	// and Offcloud there is no hashless case to guard - but a row restored from
	// an old cache could still be missing one.
	const hasInfoHash = /^[a-fA-F0-9]{40}$/.test(torrent.hash);

	const libraryActions = `
        <div class="mb-3 flex justify-center items-center flex-wrap">
            ${hasInfoHash ? renderButton('share', { link: `${await handleShare({ ...torrent, bytes: totalBytes })}` }) : ''}
            ${renderButton('delete', { id: 'btn-delete-dl' })}
            ${hasInfoHash ? renderButton('castAll', { id: 'btn-cast-all' }) : ''}
            ${hasInfoHash ? renderButton('magnet', { id: 'btn-magnet-copy-dl', text: shouldDownloadMagnets ? 'Download' : 'Copy' }) : ''}
            ${files.length ? renderButton('exportLinks', { id: 'btn-export-links-dl' }) : ''}
        </div>`;

	const infoRows = [
		{ label: 'Size', value: (totalBytes / 1024 ** 3).toFixed(2) + ' GB' },
		{ label: 'ID', value: torrent.id },
		{ label: 'Status', value: getDebridLinkStatusText(serviceStatus) },
		...(progress > 0 && progress < 100 ? [{ label: 'Progress', value: progress + '%' }] : []),
		{
			label: 'Added',
			value: new Date(torrent.added).toLocaleString(undefined, { timeZone: 'UTC' }),
		},
	];

	const zipNotice = stillZipped
		? `<div class="mb-2 rounded border border-sky-600 bg-sky-900/30 p-2 text-sm text-sky-100">
            Debrid-Link serves this release as a single archive, so the row below is the
            whole thing rather than its individual files.
        </div>`
		: '';

	const html = `<h1 class="text-lg font-bold mt-3 mb-2 text-gray-100">${torrent.filename}</h1>
    ${libraryActions}
    ${zipNotice}
    <div class="text-sm text-gray-200">
        ${renderInfoTable(infoRows)}
    </div>
    <div class="text-sm max-h-60 mb-2 text-left p-1 bg-gray-900">
        <div class="overflow-x-auto" style="max-width: 100%;">
            <table class="table-auto">
                <tbody>
                    ${renderTorrentInfoDL(
						files.map((file) => ({
							downloadUrl: file.downloadUrl,
							filename: file.name,
							filesize: file.size,
						})),
						{ canWatch: Boolean(app) }
					)}
                </tbody>
            </table>
        </div>
    </div>`;

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
		didOpen: () => {
			// Every Watch row carries its own already-playable link, so nothing
			// here resolves a hash or adds anything to the account.
			bindWatchButtons({
				service: 'dl',
				hash: torrent.hash,
				player: app ?? '',
				keys: { debridLinkKey: dlKey },
			});

			// A cast is addressed by hash, because play resolves by hash with the
			// viewer's own credential. The torrent id goes along and is what the
			// route prefers: listing by id costs no quota, while resolving by hash
			// means an add - one of the day's 50 torrents - for something the user
			// is already looking at in their own library.
			if (hasInfoHash) {
				bindCastAllButton({
					buttonId: 'btn-cast-all',
					castUrl: `/api/stremio-dl/cast/library/${torrent.hash}?torrentId=${encodeURIComponent(torrentId)}`,
					apiKey: dlKey,
					filename: torrent.filename,
				});
			}

			document
				.querySelectorAll<HTMLButtonElement>('button[data-dl-link]')
				.forEach((button) => {
					button.addEventListener('click', () => {
						window.open(button.dataset.dlLink!, '_blank');
					});
				});

			document.getElementById('btn-magnet-copy-dl')?.addEventListener('click', () => {
				void handleCopyOrDownloadMagnet(torrent.hash, shouldDownloadMagnets);
			});

			document.getElementById('btn-delete-dl')?.addEventListener('click', async () => {
				try {
					// Debrid-Link's remove never fails - it echoes back whatever id
					// it was handed - so the modal closes on "asked", and the next
					// library listing is what confirms.
					if (handlers.onDeleteDl) await handlers.onDeleteDl(dlKey, torrent.id);
					else await handleDeleteDlTorrent(dlKey, torrent.id);
					Modal.close();
				} catch (error) {
					console.error('[torrentModal] delete failed (DL)', error);
				}
			});

			// The links are already minted and keyless, so this is a plain export
			// with no per-file request behind it - unlike Premiumize's.
			document.getElementById('btn-export-links-dl')?.addEventListener('click', () => {
				const blob = new Blob([files.map((file) => file.downloadUrl).join('\n')], {
					type: 'text/plain',
				});
				const a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = `${torrent.filename}.txt`;
				a.click();
				URL.revokeObjectURL(a.href);
				toast.success('Download links exported.', magnetToastOptions);
			});
		},
	});
};
