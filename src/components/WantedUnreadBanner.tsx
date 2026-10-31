import { sponsorHeaders, useSponsor } from '@/hooks/useSponsor';
import { WANTED_GUIDE_URL, type WantedUnread, wantedUnread } from '@/utils/wantedUnread';
import { TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export const WANTED_UNREAD_DISMISS_KEY = 'wanted_unread_dismissed_at';

/** A dismissal lasts a week: long enough not to nag, short enough to remind. */
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Tells a sponsor whose wanted list no zurg has read for a day that nothing
 * is being fetched, and links the guide that sets it up. See wantedUnread.
 */
export function WantedUnreadBanner() {
	const { isSponsor } = useSponsor();
	const [unread, setUnread] = useState<WantedUnread | null>(null);

	useEffect(() => {
		if (!isSponsor) return;
		try {
			const at = Number(window.localStorage.getItem(WANTED_UNREAD_DISMISS_KEY));
			if (at && Date.now() - at < DISMISS_FOR_MS) return;
		} catch {
			// Blocked storage: show it, as the zurg banner does.
		}
		let live = true;
		fetch('/api/wanted/status', { headers: sponsorHeaders() })
			.then((res) => (res.ok ? res.json() : null))
			.then((summary) => live && summary && setUnread(wantedUnread(summary)))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [isSponsor]);

	if (!unread) return null;

	const dismiss = () => {
		setUnread(null);
		try {
			window.localStorage.setItem(WANTED_UNREAD_DISMISS_KEY, String(Date.now()));
		} catch {
			// Closes for this visit either way.
		}
	};

	return (
		<div
			role="alert"
			className="relative mb-4 w-full max-w-md rounded border-2 border-amber-500 bg-amber-900/30 p-3 text-amber-50"
		>
			<button
				onClick={dismiss}
				aria-label="Dismiss wanted list warning"
				className="haptic-sm absolute top-1 right-1 rounded p-1 text-amber-300/70 transition-colors hover:bg-amber-800/40 hover:text-amber-100"
			>
				<X className="h-4 w-4" />
			</button>
			<div className="flex items-center gap-2 pr-6 text-sm font-bold">
				<TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
				Nothing on your wanted list is being fetched
			</div>
			<p className="mt-0.5 text-xs text-amber-100/80">
				{unread.never
					? 'No zurg has read your wanted list yet. Titles you want are only fetched by a zurg with your DMM API key.'
					: `Your zurg last read your wanted list ${new Date(unread.lastPolledAt).toLocaleDateString()}. Check that it is running and still has your DMM API key.`}
			</p>
			<div className="mt-2 flex flex-wrap items-center gap-3">
				<a
					href={WANTED_GUIDE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="haptic-sm rounded border-2 border-amber-400 bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-50 transition-colors hover:bg-amber-500/40"
				>
					Set up zurg for your wanted list
				</a>
				<Link
					href="/wanted"
					className="text-xs text-amber-200/80 underline hover:text-amber-100"
				>
					Your wanted list
				</Link>
			</div>
		</div>
	);
}
