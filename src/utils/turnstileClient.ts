// The browser half of the Turnstile check in front of /api/challenge (see
// services/turnstile). Cloudflare's script runs its checks out of sight; the
// widget only appears, bottom right, when Cloudflare wants a click.

interface TurnstileApi {
	render(
		el: HTMLElement,
		options: {
			sitekey: string;
			appearance: 'interaction-only';
			callback: (token: string) => void;
			'error-callback': () => void;
			'expired-callback': () => void;
			'timeout-callback': () => void;
		}
	): string;
	remove(id: string): void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoad: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
	if (window.turnstile) return Promise.resolve(window.turnstile);
	if (!scriptLoad) {
		scriptLoad = new Promise<TurnstileApi>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = SCRIPT_URL;
			script.async = true;
			script.onload = () =>
				window.turnstile
					? resolve(window.turnstile)
					: reject(new Error('Turnstile missing'));
			script.onerror = () => reject(new Error('Could not load the browser check'));
			document.head.appendChild(script);
		}).catch((error) => {
			scriptLoad = null; // a later call may try again
			throw error;
		});
	}
	return scriptLoad;
}

/** One single-use Turnstile answer for `siteKey`. */
export async function solveTurnstile(siteKey: string): Promise<string> {
	const turnstile = await loadScript();
	const box = document.createElement('div');
	box.setAttribute('data-testid', 'turnstile');
	box.style.cssText =
		'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px)';
	document.body.appendChild(box);
	let id: string | null = null;
	try {
		return await new Promise<string>((resolve, reject) => {
			const fail = () => reject(new Error('The browser check did not pass'));
			id = turnstile.render(box, {
				sitekey: siteKey,
				appearance: 'interaction-only',
				callback: resolve,
				'error-callback': fail,
				'expired-callback': fail,
				'timeout-callback': fail,
			});
		});
	} finally {
		if (id) turnstile.remove(id);
		box.remove();
	}
}
