import { FolderTree, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export const ZURG_BANNER_DISMISS_KEY = 'zurg_banner_dismissed';

export const ZURG_SITE_URL = 'https://zurg.debridmediamanager.com/';

export function ZurgBanner() {
	// The dismissal flag is read after mount and never while rendering. Reading
	// localStorage from a useState initializer makes the prerendered markup and
	// the first client render disagree, and React throws that whole tree away.
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		try {
			if (window.localStorage.getItem(ZURG_BANNER_DISMISS_KEY) === '1') setDismissed(true);
		} catch {
			// Blocked or full storage. Showing the banner again beats crashing.
		}
	}, []);

	const dismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(ZURG_BANNER_DISMISS_KEY, '1');
		} catch {
			// Same as above. The banner still closes for this visit.
		}
	};

	if (dismissed) return null;

	return (
		<div className="relative mb-4 w-full max-w-md rounded border-2 border-sky-500 bg-gradient-to-br from-sky-900/50 to-gray-900/40 p-3 text-sky-50">
			<button
				onClick={dismiss}
				aria-label="Dismiss zurg banner"
				className="haptic-sm absolute right-1 top-1 rounded p-1 text-sky-300/70 transition-colors hover:bg-sky-800/40 hover:text-sky-100"
			>
				<X className="h-4 w-4" />
			</button>

			<p className="pr-6 text-[10px] font-bold uppercase tracking-widest text-sky-400">
				No symlinks!
			</p>

			<div className="mt-0.5 flex items-center gap-2 pr-6 text-sm font-bold">
				<FolderTree className="h-4 w-4 shrink-0 text-sky-400" />
				Your whole debrid library in one folder
			</div>

			<p className="mt-0.5 text-xs text-sky-100/80">
				Plex and Jellyfin read it like a normal drive.
			</p>

			<div className="mt-2 flex items-center gap-3">
				<a
					href={ZURG_SITE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="haptic-sm rounded border-2 border-sky-400 bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-50 transition-colors hover:bg-sky-500/40"
				>
					Get zurg
				</a>
				<span className="text-xs text-sky-200/70">
					<b className="text-sky-100">4.4x</b> faster to open a file
				</span>
			</div>
		</div>
	);
}
