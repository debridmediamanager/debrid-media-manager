import { buttonStyles, defaultLabels, icons } from './styles';
import { ActionButtonProps, FileRowProps, InfoTableRow, LibraryActionButtonProps } from './types';
import { formatSize } from './utils';

const LIBRARY_ACTION_TYPES = new Set<keyof typeof buttonStyles>([
	'share',
	'delete',
	'magnet',
	'reinsert',
	'downloadAll',
	'exportLinks',
	'generateStrm',
	'castAll',
]);

const FILE_ACTION_TYPES = new Set<keyof typeof buttonStyles>([
	'download',
	'watch',
	'cast',
	'searchAgain',
]);

/**
 * Every attribute here is built by string concatenation, and release filenames
 * legitimately contain quotes and angle brackets - one unescaped name truncates
 * the tag and takes the rest of the row with it.
 */
export const escapeAttr = (value: string): string =>
	String(value)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');

const renderDataAttrs = (data?: Record<string, string>) =>
	data
		? Object.entries(data)
				.map(([name, value]) => ` data-${name}="${escapeAttr(value)}"`)
				.join('')
		: '';

const BASE_BUTTON_CLASSES =
	'haptic-sm inline-flex items-center gap-1 rounded transition-colors cursor-pointer';
const BUTTON_SIZE_CLASSES = {
	default: 'px-3 py-1.5 text-sm',
	file: 'px-1 py-0.5 text-xs',
	library: 'px-3 py-1.5 text-sm',
} as const;

export const renderButton = (
	type: keyof typeof buttonStyles,
	props: ActionButtonProps | LibraryActionButtonProps
) => {
	const style = buttonStyles[type];
	const iconMarkup = icons[type] ? `${icons[type]} ` : '';
	const defaultLabel = defaultLabels[type];
	const isLibraryAction = LIBRARY_ACTION_TYPES.has(type);
	const spacingClass = isLibraryAction ? 'm-1' : '';
	const touchClass = isLibraryAction ? 'touch-manipulation' : '';
	const sizeClass = isLibraryAction
		? BUTTON_SIZE_CLASSES.library
		: FILE_ACTION_TYPES.has(type)
			? BUTTON_SIZE_CLASSES.file
			: BUTTON_SIZE_CLASSES.default;
	const buttonClasses = [BASE_BUTTON_CLASSES, sizeClass, style, spacingClass, touchClass]
		.filter(Boolean)
		.join(' ');

	// If link is provided, render a form that opens in a new tab.
	// Collect hidden inputs from link params when supplied.
	if ('link' in props) {
		const idAttr = props.id ? ` id="${props.id}"` : '';
		const paramList = [
			...(('linkParams' in props && props.linkParams) || []),
			...(props.linkParam ? [props.linkParam] : []),
		];
		const hiddenInputs = paramList
			.map(
				(param) =>
					`<input type="hidden" name="${param.name}" value="${escapeAttr(param.value)}" />`
			)
			.join('');
		return `<form action="${props.link}" method="get" target="_blank" class="inline-block">
	            ${hiddenInputs}
	            <button type="submit" class="${buttonClasses}"${idAttr}>${iconMarkup}${
					props.text || defaultLabel
				}</button>
	        </form>`;
	}

	// Support both legacy inline onClick (if still passed) and id for external binding
	const onClickAttr = 'onClick' in props && props.onClick ? ` onclick="${props.onClick}"` : '';
	const idAttr = 'id' in props && (props as any).id ? ` id="${(props as any).id}"` : '';
	const dataAttrs = renderDataAttrs('data' in props ? props.data : undefined);

	return `<button type="button" class="${buttonClasses}"${idAttr}${onClickAttr}${dataAttrs}>${iconMarkup}${
		'text' in props ? props.text || defaultLabel : defaultLabel
	}</button>`;
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
                data-file-path="${escapeAttr(file.path)}"
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
                <span class="text-blue-300">${escapeAttr(file.path)}</span>
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
