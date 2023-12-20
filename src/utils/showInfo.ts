import { getTorrentInfo } from '@/services/realDebrid';
import { UserTorrent } from '@/torrent/userTorrent';
import Swal from 'sweetalert2';

export const showInfo = async (rdKey: string, torrent: UserTorrent) => {
	const info = await getTorrentInfo(rdKey, torrent.id.substring(3));

	let warning = '';
	const isIntact = info.files.filter((f) => f.selected).length === info.links.length;
	// Check if there is a mismatch between files and links
	if (info.progress === 100 && !isIntact) {
		warning = `<p class="text-red-500">Warning: Some files have expired</p>`;
	}

	// Initialize a separate index for the links array
	let linkIndex = 0;

	const filesList = info.files
		.map((file) => {
			let size = file.bytes < 1024 ** 3 ? file.bytes / 1024 ** 2 : file.bytes / 1024 ** 3;
			let unit = file.bytes < 1024 ** 3 ? 'MB' : 'GB';

			let downloadForm = '';

			// Only create a download form for selected files
			if (file.selected && isIntact) {
				downloadForm = `
                    <form action="https://real-debrid.com/downloader" method="get" target="_blank" class="inline">
                        <input type="hidden" name="links" value="${info.links[linkIndex++]}" />
                        <button type="submit" class="ml-1 bg-blue-500 hover:bg-blue-700 text-white font-bold py-0 px-1 rounded text-xs">Download</button>
                    </form>
                `;
			}

			// Return the list item for the file, with or without the download form
			return `
                <li class="flex items-center justify-between p-2 hover:bg-yellow-200 rounded ${
					file.selected ? 'bg-yellow-50 font-bold' : 'font-normal'
				}">
                    <span class="flex-1 truncate text-blue-600">${file.path}</span>
                    <span class="ml-4 text-sm text-gray-700">${size.toFixed(2)} ${unit}</span>
                    ${downloadForm}
                </li>
              `;
		})
		.join('');

	// Handle the display of progress, speed, and seeders as table rows
	const progressRow =
		info.status === 'downloading'
			? `<tr><td class="font-semibold align-left">Progress:</td><td class="align-left">${info.progress.toFixed(
					2
			  )}%</td></tr>`
			: '';
	const speedRow =
		info.status === 'downloading'
			? `<tr><td class="font-semibold align-left">Speed:</td><td class="align-left">${(
					info.speed / 1024
			  ).toFixed(2)} KB/s</td></tr>`
			: '';
	const seedersRow =
		info.status === 'downloading'
			? `<tr><td class="font-semibold align-left">Seeders:</td><td class="align-left">${info.seeders}</td></tr>`
			: '';

	Swal.fire({
		icon: 'info',
		html: `
        <h1 class="text-2xl font-bold mb-4">${info.filename}</h1>
        <div class="overflow-x-auto">
            <table class="table-auto w-full mb-4 text-left">
                <tbody>
                    <tr>
                        <td class="font-semibold">ID:</td>
                        <td>${info.id}</td>
                    </tr>
                    <tr>
                        <td class="font-semibold">Original filename:</td>
                        <td>${info.original_filename}</td>
                    </tr>
                    <tr>
                        <td class="font-semibold">Size:</td>
                        <td>${(info.bytes / 1024 ** 3).toFixed(2)} GB</td>
                    </tr>
                    <tr>
                        <td class="font-semibold">Original size:</td>
                        <td>${(info.original_bytes / 1024 ** 3).toFixed(2)} GB
                        </td>
                    </tr>
                    <tr>
                        <td class="font-semibold">Status:</td>
                        <td>${info.status}</td>
                    </tr>
                    ${progressRow}
                    ${speedRow}
                    ${seedersRow}
                    <tr>
                        <td class="font-semibold">Added:</td>
                        <td>${new Date(info.added).toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        ${warning}
        <h2 class="text-xl font-semibold mb-2">Files:</h2>
        <div class="max-h-60 overflow-y-auto mb-4 text-left bg-blue-100 p-4 rounded shadow">
            <ul class="list space-y-1">
                ${filesList}
            </ul>
        </div>

            `,
		showConfirmButton: false,
		customClass: {
			popup: 'format-class',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
	});
};
