import Modal from '@/components/modals/modal';
import { getLocalStorageItem } from '@/utils/browserStorage';

/**
 * Where a magnet sent to /library?addMagnet= goes: the browser extension's DMM
 * button and the registered magnet handler both open that URL.
 */
export type MagnetProvider = 'rd' | 'ad' | 'tb' | 'pm' | 'oc' | 'dl';
export type MagnetChoice = MagnetProvider | 'all';

/** A `settings:` key, so the choice rides along with "remember across devices". */
export const MAGNET_PROVIDER_KEY = 'settings:addMagnetProvider';

const NAMES: Record<MagnetProvider, string> = {
	rd: 'Real-Debrid',
	ad: 'AllDebrid',
	tb: 'TorBox',
	pm: 'Premiumize',
	oc: 'Offcloud',
	dl: 'Debrid-Link',
};

/**
 * The providers that receive the add. One sign-in gets it with no question.
 * With several, null means "ask first": adding to every account started a
 * download on each of them (card 359). `all` keeps that behaviour on purpose.
 */
export function magnetTargets(
	signedIn: MagnetProvider[],
	choice: MagnetChoice | null
): MagnetProvider[] | null {
	if (signedIn.length <= 1 || choice === 'all') return signedIn;
	if (choice && signedIn.includes(choice)) return [choice];
	return null;
}

/** Asks which signed-in provider gets the magnet; null if the user cancels. */
export async function pickMagnetProvider(signedIn: MagnetProvider[]): Promise<MagnetChoice | null> {
	const stored = getLocalStorageItem(MAGNET_PROVIDER_KEY);
	const options: MagnetChoice[] = [...signedIn, 'all'];
	const preselected = options.find((o) => o === stored) ?? signedIn[0];
	const radios = options
		.map(
			(o) =>
				`<label class="flex items-center gap-3 rounded px-3 py-2 hover:bg-gray-800 cursor-pointer"><input type="radio" name="add-magnet-provider" value="${o}"${o === preselected ? ' checked' : ''} class="h-4 w-4" /><span>${o === 'all' ? 'All of them' : NAMES[o]}</span></label>`
		)
		.join('');
	const result = await Modal.fire({
		title: 'Add magnet to',
		html: `<div class="flex flex-col gap-1 text-left">${radios}</div>`,
		showCancelButton: true,
		confirmButtonText: 'Add',
		preConfirm: () =>
			(
				document.querySelector(
					'input[name="add-magnet-provider"]:checked'
				) as HTMLInputElement | null
			)?.value ?? false,
	});
	if (!result.isConfirmed || !options.includes(result.value)) return null;
	try {
		window.localStorage.setItem(MAGNET_PROVIDER_KEY, result.value);
	} catch {}
	return result.value;
}
