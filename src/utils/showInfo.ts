import { getTorrentInfo } from '@/services/realDebrid';
import { UserTorrent } from '@/torrent/userTorrent';
import Swal from 'sweetalert2';

export const showInfo = async (app: string, rdKey: string, torrent: UserTorrent) => {
	const info = await getTorrentInfo(rdKey, torrent.id.substring(3));

	let warning = '';
	const isIntact = info.files.filter((f) => f.selected).length === info.links.length;
	if (info.progress === 100 && !isIntact) {
		warning = `<div class="text-xs text-red-500">Warning: Some files have expired</div>`;
	}

	let linkIndex = 0;

	const filesList = info.files
		.map((file) => {
			let size = file.bytes < 1024 ** 3 ? file.bytes / 1024 ** 2 : file.bytes / 1024 ** 3;
			let unit = file.bytes < 1024 ** 3 ? 'MB' : 'GB';

			let downloadForm = '';
			let watchBtn = ``;

			if (file.selected && isIntact) {
				const fileLink = info.links[linkIndex++];
				downloadForm = `
                    <form action="https://real-debrid.com/downloader" method="get" target="_blank" class="inline">
                        <input type="hidden" name="links" value="${fileLink}" />
                        <button type="submit" class="inline ml-1 bg-blue-500 hover:bg-blue-700 text-white font-bold py-0 px-1 rounded text-xs">Download</button>
                    </form>
                `;
				if (app) {
					watchBtn = `
                        <button type="button" class="inline ml-1 bg-orange-500 hover:bg-orange-700 text-white font-bold py-0 px-1 rounded text-xs" onclick="window.open('/api/watch/infuse?token=${rdKey}&link=${fileLink}')">Infuse</button>
                        <button type="button" class="inline ml-1 bg-orange-500 hover:bg-orange-700 text-white font-bold py-0 px-1 rounded text-xs" onclick="window.open('/api/watch/vlc?token=${rdKey}&link=${fileLink}')">VLC</button>
                        <button type="button" class="inline ml-1 bg-orange-500 hover:bg-orange-700 text-white font-bold py-0 px-1 rounded text-xs" onclick="window.open('/api/watch/outplayer?token=${rdKey}&link=${fileLink}')">Outplayer</button>
                    `;
				}
			}

			// Return the list item for the file, with or without the download form
			return `
                <li class="hover:bg-yellow-200 rounded ${
					file.selected ? 'bg-yellow-50 font-bold' : 'font-normal'
				}">
                    <span class="inline text-blue-600">${file.path}</span>
                    <span class="inline text-gray-700 w-fit">${size.toFixed(2)} ${unit}</span>
                        ${downloadForm}
                        ${watchBtn}
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
		// icon: 'info',
		html: `
        <h1 class="text-lg font-bold mt-6 mb-4">${info.filename}</h1>
        <div class="text-xs">
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
        <div class="text-xs max-h-60 mb-4 text-left bg-blue-100 p-1">
            <ul class="list space-y-1">
                ${filesList}
            </ul>
        </div>

            `,
		showConfirmButton: false,
		customClass: {
			htmlContainer: '!mx-1',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
	});
};
