import { magnetToastOptions } from '@/utils/toastOptions';
import toast from 'react-hot-toast';

export interface CastFileOptions {
	imdbId: string;
	hash: string;
	mediaType: 'movie' | 'tv';
	/** The Real-Debrid key. Sent as a bearer token, never in the URL. */
	apiKey: string;
}

const SPINNER = '<span class="inline-block animate-spin">⌛</span>';

/**
 * Wires every per-file Cast button in the open Real-Debrid info window.
 *
 * Each button used to be a `<form method="get" target="_blank">` posting the
 * key as `?token=`, so a click wrote it into dmm-01's access log, the new tab's
 * history and the Referer of that tab's favicon request (card 210). It now
 * goes the way the season Cast buttons and Cast All do: a fetch with the key
 * in the Authorization header, then a jump to the Stremio link it answers with.
 */
export function bindCastFileButtons({ imdbId, hash, mediaType, apiKey }: CastFileOptions): void {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>('button[data-cast-file-id]')
	).filter((button) => !button.dataset.castBound);

	buttons.forEach((button) => {
		button.dataset.castBound = '1';
		button.addEventListener('click', async () => {
			if (button.disabled) return;
			const fileId = button.dataset.castFileId ?? '';
			const original = button.innerHTML;
			button.disabled = true;
			button.classList.add('opacity-50', 'pointer-events-none');
			button.innerHTML = `${SPINNER} Cast`;
			const toastId = toast.loading('Casting...', magnetToastOptions);
			try {
				const query = new URLSearchParams({ hash, fileId, mediaType });
				const response = await fetch(`/api/stremio/cast/${imdbId}?${query}`, {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				const data = await response.json().catch(() => ({}));
				toast.dismiss(toastId);
				if (response.ok && data.status === 'success' && data.redirectUrl) {
					toast.success(data.message || 'Opening in Stremio...', magnetToastOptions);
					window.location.href = data.redirectUrl;
					return;
				}
				toast.error(data.errorMessage || 'Failed to cast', magnetToastOptions);
			} catch (error) {
				toast.dismiss(toastId);
				console.error('[torrentModal] cast failed', error);
				toast.error('Failed to cast to Stremio', magnetToastOptions);
			} finally {
				button.disabled = false;
				button.classList.remove('opacity-50', 'pointer-events-none');
				button.innerHTML = original;
			}
		});
	});
}
