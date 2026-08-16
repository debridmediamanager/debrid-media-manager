import { WatchKeys, WatchService, openWatch } from '@/utils/watchService';

export type BindWatchButtonsOptions = {
	/**
	 * The service the modal was opened for. A library torrent lives in exactly
	 * one account; a search result's modal is opened by `pickInfoService`, which
	 * is the same RD > AD > TB rule the Watch button on the result card uses.
	 */
	service: WatchService;
	hash: string;
	player: string;
	keys: WatchKeys;
	/** AD only: the magnet is the user's own library entry, so leave it alone. */
	adInLibrary?: boolean;
};

const SPINNER = '<span class="inline-block animate-spin">⌛</span>';

/**
 * Wires every Watch row in the open modal to `openWatch`.
 *
 * These used to be `<form method="get">` submissions straight at the API, which
 * meant no spinner, no error toast (a failure landed the user on a raw JSON 500
 * in a new tab), and the debrid key in the query string. Going through
 * `openWatch` puts them on the same path as the Watch button on a result card.
 */
export const bindWatchButtons = (options: BindWatchButtonsOptions): void => {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>('button[data-watch]')
	).filter((button) => !button.dataset.watchBound);

	buttons.forEach((button) => {
		button.dataset.watchBound = '1';
		button.addEventListener('click', async () => {
			if (button.disabled) return;
			const original = button.innerHTML;
			button.disabled = true;
			button.classList.add('opacity-50', 'pointer-events-none');
			button.innerHTML = `${SPINNER} Watch`;
			try {
				await openWatch({
					service: options.service,
					player: options.player,
					hash: options.hash,
					keys: options.keys,
					link: button.dataset.watchLink || undefined,
					fileName: button.dataset.watchFileName || undefined,
					fileId: button.dataset.watchFileId || undefined,
					adInLibrary: options.adInLibrary,
				});
			} catch (error) {
				// openWatch reports its own failures. This only keeps a rejected
				// promise from escaping the listener as an unhandled rejection,
				// which nothing would be left to catch.
				console.error('[torrentModal] watch failed', error);
			} finally {
				button.disabled = false;
				button.classList.remove('opacity-50', 'pointer-events-none');
				button.innerHTML = original;
			}
		});
	});
};
