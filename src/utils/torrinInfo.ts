import { getTorrinTorrentInfo, unrestrictTorrinLink } from '@/services/torrin';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { Dispatch, SetStateAction } from 'react';
import toast from 'react-hot-toast';
import Modal from '../components/modals/modal';
import { handleDeleteTrTorrent } from './deleteTorrent';

export const escapeHtml = (s: string): string =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);

const toGb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(2);

export async function handleShowInfoForTorrin(
	t: UserTorrent,
	baseUrl: string,
	apiKey: string,
	setUserTorrentsList: (fn: (prev: UserTorrent[]) => UserTorrent[]) => void,
	torrentDB: UserTorrentDB,
	setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>
) {
	Modal.showLoading();
	let info;
	try {
		info = await getTorrinTorrentInfo(baseUrl, apiKey, t.id.substring(3));
	} catch (error) {
		Modal.close();
		toast.error(`Torrin: ${error instanceof Error ? error.message : 'failed to load info'}`);
		return;
	}

	const selectedFiles = info.files.filter((f) => f.selected);
	const rows = selectedFiles
		.map((f, i) => {
			const name = f.path.split('/').pop() || f.path;
			const hasLink = i < info.links.length;
			return `<tr class="border-b border-gray-700">
				<td class="py-1 pr-2 text-left text-sm text-gray-200" style="word-break:break-all">${escapeHtml(name)}</td>
				<td class="whitespace-nowrap px-2 py-1 text-right text-xs text-gray-400">${toGb(f.bytes)} GB</td>
				<td class="py-1 pl-2 text-right">${
					hasLink
						? `<button data-tr-play="${i}" class="haptic-sm rounded border border-green-500 bg-green-900/30 px-2 py-0.5 text-xs text-green-100">Play</button>`
						: ''
				}</td>
			</tr>`;
		})
		.join('');

	const html = `
		<h1 class="mb-1 mt-2 text-lg font-bold text-gray-100" style="word-break:break-all">${escapeHtml(info.filename)}</h1>
		<div class="mb-3 text-xs text-gray-400">${escapeHtml(info.status)} &middot; ${toGb(info.bytes)} GB &middot; ${selectedFiles.length} file(s)</div>
		<div class="mb-3 flex justify-center">
			<button id="tr-delete" class="haptic-sm rounded border-2 border-red-500 bg-red-900/30 px-3 py-1 text-sm text-red-100">Delete from Torrin</button>
		</div>
		<hr class="border-gray-600"/>
		<div class="mt-2 max-h-72 overflow-y-auto text-left">
			<table class="w-full table-auto"><tbody>${rows}</tbody></table>
		</div>`;

	await Modal.fire({
		html,
		showConfirmButton: false,
		showCancelButton: false,
		customClass: { popup: '!bg-gray-900 !text-gray-100 !px-4 !py-3' },
		width: '640px',
		showCloseButton: true,
		didOpen: () => {
			document.querySelectorAll<HTMLButtonElement>('[data-tr-play]').forEach((btn) => {
				btn.addEventListener('click', async () => {
					const idx = parseInt(btn.getAttribute('data-tr-play') || '0', 10);
					const link = info.links[idx];
					if (!link) return;
					const original = btn.textContent;
					btn.textContent = '...';
					btn.disabled = true;
					try {
						const resp = await unrestrictTorrinLink(baseUrl, apiKey, link);
						window.open(resp.download, '_blank');
					} catch (e) {
						toast.error('Torrin: could not get stream link');
					} finally {
						btn.textContent = original;
						btn.disabled = false;
					}
				});
			});

			const deleteBtn = document.getElementById('tr-delete');
			deleteBtn?.addEventListener('click', async () => {
				const ok = await handleDeleteTrTorrent(baseUrl, apiKey, t.id);
				if (!ok) return;
				setUserTorrentsList((prev) => prev.filter((x) => x.id !== t.id));
				await torrentDB.deleteById(t.id);
				setSelectedTorrents((prev) => {
					prev.delete(t.id);
					return new Set(prev);
				});
				Modal.close();
			});
		},
	});
}
