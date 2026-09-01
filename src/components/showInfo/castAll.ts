import { magnetToastOptions } from '@/utils/toastOptions';
import toast from 'react-hot-toast';
import Modal from '../modals/modal';

export interface CastAllOptions {
	/** DOM id of the button to bind. */
	buttonId: string;
	/** Library cast endpoint, without the `imdbId` parameter. */
	castUrl: string;
	/** The provider key. Sent as a bearer token, never in the URL. */
	apiKey: string;
	/** Shown in the IMDB prompt when the server cannot name the release. */
	filename: string;
	log?: (event: string, data?: Record<string, unknown>) => void;
}

const withImdbId = (castUrl: string, imdbId: string) =>
	`${castUrl}${castUrl.includes('?') ? '&' : '?'}imdbId=${encodeURIComponent(imdbId)}`;

/**
 * Asks the user for an IMDB id the server could not resolve from the hash.
 * Returns null if they cancel.
 */
async function promptForImdbId(releaseName: string): Promise<string | null> {
	const result = await Modal.fire({
		title: 'IMDB ID Required',
		html: `<p class="text-gray-300 mb-4">Could not determine the IMDB ID for this torrent. Please enter it manually.</p>
			<p class="text-gray-400 text-sm mb-2">Torrent: ${releaseName}</p>
			<input type="text" id="imdb-input" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white" placeholder="tt1234567" />
			<p class="text-gray-500 text-xs mt-2">Find the IMDB ID on <a href="https://www.imdb.com" target="_blank" class="text-blue-400 underline">imdb.com</a></p>`,
		showCancelButton: true,
		confirmButtonText: 'Cast',
		customClass: {
			popup: '!bg-gray-900 !text-gray-100',
			confirmButton: 'haptic',
			cancelButton: 'haptic',
		},
		preConfirm: () => {
			const input = document.getElementById('imdb-input') as HTMLInputElement;
			const imdbId = input?.value?.trim();
			if (!imdbId || !/^tt\d{7,}$/.test(imdbId)) {
				Modal.showValidationMessage('Please enter a valid IMDB ID (e.g., tt1234567)');
				return false;
			}
			return imdbId;
		},
	});
	return result.isConfirmed && result.value ? String(result.value) : null;
}

/**
 * Wires the info modal's "Cast" button to a provider's library cast endpoint.
 *
 * Shared by all four providers so they behave identically, and so the key is
 * sent one way: as a bearer token. It used to ride in the query string for
 * Real-Debrid, which writes it verbatim into the nginx and Cloudflare access
 * logs on dmm-01 - and an RD `apitoken` never expires.
 */
export function bindCastAllButton({
	buttonId,
	castUrl,
	apiKey,
	filename,
	log,
}: CastAllOptions): void {
	const button = document.getElementById(buttonId);
	log?.('binding cast-all button', { exists: Boolean(button), buttonId });
	if (!button) return;

	const send = async (imdbId?: string) => {
		const response = await fetch(imdbId ? withImdbId(castUrl, imdbId) : castUrl, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		return response.json();
	};

	const succeed = (data: any) => {
		window.location.href = data.redirectUrl;
		toast.success('Opening in Stremio...', magnetToastOptions);
	};

	button.addEventListener('click', async () => {
		log?.('cast-all clicked', { buttonId });
		const toastId = toast.loading('Preparing cast...', magnetToastOptions);
		try {
			const data = await send();

			if (data.status === 'need_imdb_id') {
				toast.dismiss(toastId);
				const imdbId = await promptForImdbId(data.torrentInfo?.filename || filename);
				if (!imdbId) return;

				const retryToastId = toast.loading('Casting...', magnetToastOptions);
				try {
					const retryData = await send(imdbId);
					toast.dismiss(retryToastId);
					if (retryData.status === 'success') {
						succeed(retryData);
					} else {
						toast.error(retryData.errorMessage || 'Failed to cast', magnetToastOptions);
					}
				} catch (error) {
					toast.dismiss(retryToastId);
					toast.error('Failed to cast to Stremio', magnetToastOptions);
				}
				return;
			}

			toast.dismiss(toastId);
			if (data.status === 'success') {
				succeed(data);
			} else {
				toast.error(data.errorMessage || 'Failed to cast', magnetToastOptions);
			}
		} catch (error) {
			toast.dismiss(toastId);
			console.error('Cast error:', error);
			toast.error('Failed to cast to Stremio', magnetToastOptions);
		}
	});
}
