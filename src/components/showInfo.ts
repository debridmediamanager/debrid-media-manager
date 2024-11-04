import { MagnetStatus } from '@/services/allDebrid';
import { TorrentInfoResponse } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import Swal from 'sweetalert2';

const formatSize = (bytes: number): { size: number; unit: string } => {
    const isGB = bytes >= 1024 ** 3;
    return {
        size: bytes / (isGB ? 1024 ** 3 : 1024 ** 2),
        unit: isGB ? 'GB' : 'MB'
    };
};

type ActionButtonProps = {
    link?: string;
    onClick?: string;
    text?: string;
    linkParam?: { name: string; value: string };
};

const renderActionButton = (
    type: 'download' | 'watch' | 'cast',
    props: ActionButtonProps
) => {
    const styles = {
        download: 'bg-blue-500 hover:bg-blue-700',
        watch: 'bg-teal-500 hover:bg-teal-700',
        cast: 'bg-black'
    };
    
    const icon = {
        download: '📲',
        watch: '🧐',
        cast: '✨'
    };

    return props.link ? 
        `<form action="${props.link}" method="get" target="_blank" class="inline">
            <input type="hidden" name="${props.linkParam?.name || 'links'}" value="${props.linkParam?.value || props.onClick || ''}" />
            <button type="submit" class="inline m-0 ${styles[type]} text-white font-bold py-0 px-1 rounded text-sm border border-black">${icon[type]} ${props.text || type}</button>
        </form>` :
        `<button type="button" class="inline m-0 ${styles[type]} text-white font-bold py-0 px-1 rounded text-sm border border-black" onclick="${props.onClick}">${icon[type]} ${props.text || type}</button>`;
};

const renderFileRow = (file: {
    path: string;
    size: number;
    isSelected?: boolean;
    isPlayable?: boolean;
    actions: string[];
}) => {
    const { size, unit } = formatSize(file.size);
    return `
        <tr class="${file.isPlayable || file.isSelected ? 'bg-yellow-50 font-bold' : 'font-normal'} hover:bg-yellow-200 rounded">
            <td class="text-blue-600 truncate pr-2" style="width: 80%; min-width: 0;">
                ${file.path}
            </td>
            <td class="text-gray-700 text-right whitespace-nowrap px-2" style="width: auto;">
                ${size.toFixed(2)} ${unit}
            </td>
            <td class="text-right whitespace-nowrap pl-2" style="width: auto;">
                ${file.actions.join('')}
            </td>
        </tr>
    `;
};

type InfoTableRow = {
    label: string;
    value: string | number;  // Allow both string and number
};

const renderInfoTable = (rows: InfoTableRow[]) => `
    <table class="table-auto w-full mb-4 text-left">
        <tbody>
            ${rows.map(row => `
                <tr>
                    <td class="font-semibold">${row.label}:</td>
                    <td>${row.value.toString()}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
`;

export const showInfoForRD = async (
	app: string,
	rdKey: string,
	info: TorrentInfoResponse,
	userId: string = '',
	imdbId: string = '',
	mediaType: string = 'movie' // 'movie' | 'tv'
) => {
	let warning = '',
		downloadAllBtn = '';
	const isIntact = info.fake || info.files.filter((f) => f.selected).length === info.links.length;
	if (info.progress === 100 && !isIntact) {
		if (info.links.length === 1) {
			warning = `<div class="text-sm text-red-500">Warning: This torrent appears to have been rar'ed by Real-Debrid<br/></div>`;
			downloadAllBtn = `<form action="https://real-debrid.com/downloader" method="get" target="_blank" class="inline">
			<input type="hidden" name="links" value="${info.links[0]}" />
			<button type="submit" class="inline m-0 bg-green-500 hover:bg-green-700 text-white font-bold py-0 px-1 rounded text-sm border border-black">🗄️ Download RAR</button>
		</form>`;
		} else {
			warning = `<div class="text-sm text-red-500">Warning: Some files have expired</div>`;
		}
	}
	if (info.links.length > 1) {
		downloadAllBtn = `<form action="https://real-debrid.com/downloader" method="get" target="_blank" class="inline">
			<input type="hidden" name="links" value="${info.links.join('\n')}" />
			<button type="submit" class="inline m-0 bg-green-500 hover:bg-green-700 text-white font-bold py-0 px-1 rounded text-sm border border-black">🔗 Download all links</button>
		</form>`;
	}
	if (info.links.length > 0) {
		downloadAllBtn += `
		<button type="button" class="inline m-0 bg-sky-500 hover:bg-sky-700 text-white font-bold py-0 px-1 rounded text-sm border border-black" onclick="exportLinks('${info.original_filename}', [${info.links.map((l) => `'${l}'`).join(',')}])">📤 Export DL links</button>
	`;
	}

	let linkIndex = 0;

	const filesList = info.files.map(file => {
        const actions = [];
        if (file.selected && isIntact) {
            const fileLink = info.links[linkIndex++];
            if (!info.fake) {
                actions.push(renderActionButton('download', { 
                    link: 'https://real-debrid.com/downloader',
                    linkParam: { name: 'links', value: fileLink },
					text: 'DL'
                }));
            }
            if (app) {
                if (info.fake) {
                    actions.push(renderActionButton('watch', { 
                        onClick: `window.open('/api/watch/instant/${app}?token=${rdKey}&hash=${info.hash}&fileId=${file.id}')`,
						text: 'Watch'
                    }));
                } else {
                    actions.push(renderActionButton('watch', { 
                        onClick: `window.open('/api/watch/${app}?token=${rdKey}&link=${fileLink}')`,
						text: 'Watch'
                    }));
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
                    actions.push(renderActionButton('cast', { 
                        onClick: `window.open('/api/stremio/${userId}/cast/${imdbId}?token=${rdKey}&hash=${info.hash}&fileId=${file.id}&mediaType=${mediaType}')`,
                        text: 'Cast'
                    }));
                }
            }
        }
        
        return renderFileRow({
            path: file.path,
            size: file.bytes,
            isSelected: Boolean(file.selected),  // Ensure boolean type
            actions
        });
    }).join('');

	// Handle the display of progress, speed, and seeders as table rows
	const progressRow =
		info.status === 'downloading'
			? `<tr><td class="font-semibold">Progress:</td><td>${info.progress.toFixed(2)}%</td></tr>`
			: '';
	const speedRow =
		info.status === 'downloading'
			? `<tr><td class="font-semibold">Speed:</td><td>${(info.speed / 1024).toFixed(2)} KB/s</td></tr>`
			: '';
	const seedersRow =
		info.status === 'downloading'
			? `<tr><td class="font-semibold">Seeders:</td><td>${info.seeders}</td></tr>`
			: '';

	// Update the wrapping HTML to include a table
	let html = `<h1 class="text-lg font-bold mt-6 mb-4">${info.filename}</h1>
	<hr/>
	<div class="text-sm max-h-60 mb-4 text-left p-1">
		<table class="table-auto w-full">
			<tbody>
				${filesList}
			</tbody>
		</table>
	</div>`;

	if (!info.fake)
		html = html.replace(
			'<hr/>',
			`<div class="text-sm">
            ${renderInfoTable([
                { label: 'Size', value: (info.bytes / 1024 ** 3).toFixed(2) + ' GB' },
                { label: 'ID', value: info.id },
                { label: 'Original filename', value: info.original_filename },
                { label: 'Original size', value: (info.original_bytes / 1024 ** 3).toFixed(2) + ' GB' },
                { label: 'Status', value: info.status },
                ...(info.status === 'downloading' ? [
                    { label: 'Progress', value: info.progress.toFixed(2) + '%' },
                    { label: 'Speed', value: (info.speed / 1024).toFixed(2) + ' KB/s' },
                    { label: 'Seeders', value: info.seeders }
                ] : []),
                { label: 'Added', value: new Date(info.added).toLocaleString() }
            ])}
        ${warning}${downloadAllBtn}`
		);
	Swal.fire({
		// icon: 'info',
		html,
		showConfirmButton: false,
		customClass: {
			htmlContainer: '!mx-1',
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
) => {
	const filesList = info.links.map(file => {
        const actions = [
            renderActionButton('download', { 
                link: 'https://alldebrid.com/service/',
                linkParam: { name: 'url', value: file.link },
				text: 'DL'
            })
        ];
        
        return renderFileRow({
            path: file.filename,
            size: file.size,
            isPlayable: Boolean(isVideo({ path: file.filename })),  // Ensure boolean type
            actions
        });
    }).join('');

	// Update the wrapping HTML to include a table
	let html = `<h1 class="text-lg font-bold mt-6 mb-4">${info.filename}</h1>
	<hr/>
	<div class="text-sm max-h-60 mb-4 text-left bg-blue-100 p-1">
		<table class="table-auto w-full">
			<tbody>
				${filesList}
			</tbody>
		</table>
	</div>`;
	html = html.replace(
		'<hr/>',
		`<div class="text-sm">
		${renderInfoTable([
            { label: 'Size', value: (info.size / 1024 ** 3).toFixed(2) + ' GB' },
            { label: 'ID', value: info.id },
            { label: 'Status', value: `${info.status} (code: ${info.statusCode})` },
            { label: 'Added', value: new Date(info.uploadDate * 1000).toLocaleString() }
        ])}
	</div>`
	);

	Swal.fire({
		// icon: 'info',
		html,
		showConfirmButton: false,
		customClass: {
			htmlContainer: '!mx-1',
		},
		width: '800px',
		showCloseButton: true,
		inputAutoFocus: true,
	});
};
