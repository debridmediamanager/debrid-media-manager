import { buttonStyles, defaultLabels, icons } from './styles';
import { ActionButtonProps, FileRowProps, InfoTableRow, LibraryActionButtonProps } from './types';
import { formatSize } from './utils';

export const renderButton = (
	type: keyof typeof buttonStyles,
	props: ActionButtonProps | LibraryActionButtonProps
) => {
	const style = buttonStyles[type];
	const icon = icons[type];
	const defaultLabel = defaultLabels[type];

	if ('link' in props) {
		return `<form action="${props.link}" method="get" target="_blank" class="inline">
            <input type="hidden" name="${props.linkParam?.name || 'links'}" value="${props.linkParam?.value || props.onClick || ''}" />
            <button type="submit" class="inline m-0 ${style} text-xs rounded px-1 haptic-sm">${icon} ${props.text || defaultLabel}</button>
        </form>`;
	}

	const isLibraryAction = [
		'share',
		'delete',
		'magnet',
		'reinsert',
		'downloadAll',
		'exportLinks',
		'generateStrm',
		'castAll',
	].includes(type);
	const textSize = isLibraryAction ? 'text-base' : 'text-xs';
	const touchClass = isLibraryAction ? 'touch-manipulation' : '';

	return `<button type="button" class="inline ${style} ${textSize} rounded cursor-pointer ${touchClass}" onclick="${props.onClick}">${icon} ${'text' in props ? props.text || defaultLabel : defaultLabel}</button>`;
};

export const renderFileRow = (file: FileRowProps, showCheckbox: boolean = false): string => {
	const { size, unit } = formatSize(file.size);
	const checkboxId = `file-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
	const checkboxColumn = showCheckbox
		? `
        <td class="pr-2">
            <input type="checkbox"
                id="${checkboxId}"
                class="file-selector"
                data-file-id="${file.id}"
                data-file-path="${file.path}"
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

export const renderInfoTable = (rows: InfoTableRow[]): string => `
    <div class="overflow-x-auto">
        <table class="min-w-full table-auto mb-4 text-left text-gray-200">
            ${rows
				.map(
					(row) => `
                    <tr>
                        <td class="font-semibold pr-4 truncate">${row.label}</td>
                        <td>${row.value.toString()}</td>
                    </tr>
                `
				)
				.join('')}
        </table>
    </div>
`;
