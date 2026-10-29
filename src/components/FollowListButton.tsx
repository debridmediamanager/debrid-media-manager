import { sponsorHeaders, useSponsor } from '@/hooks/useSponsor';
import type { FollowListResponse } from '@/pages/api/wanted/lists';
import { BookmarkPlus, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

const BUTTON =
	'haptic-sm inline-flex items-center rounded border-2 border-rose-500 bg-rose-900/30 px-2 py-1 text-sm text-rose-100 transition-colors hover:bg-rose-800/50 disabled:cursor-not-allowed disabled:opacity-50';

/** What following or re-reading a list did, in the words the arr import uses. */
export function followSummary(r: FollowListResponse): string {
	const parts = [
		`Following ${r.name} (${r.count.toLocaleString()} title${r.count === 1 ? '' : 's'}): ${r.added.toLocaleString()} added`,
	];
	if (r.alreadyWanted) parts.push(`${r.alreadyWanted.toLocaleString()} already wanted`);
	if (r.overCap) parts.push(`${r.overCap.toLocaleString()} did not fit, the list is full`);
	let text = parts.join(', ') + '.';
	if (r.noImdbId) text += ` ${r.noImdbId.toLocaleString()} left out for having no IMDb id.`;
	return text;
}

/** Follows a list by its page URL: `POST /api/wanted/lists`, which reads it at once. */
export async function followList(url: string): Promise<FollowListResponse> {
	const res = await fetch('/api/wanted/lists', {
		method: 'POST',
		headers: { ...sponsorHeaders(), 'Content-Type': 'application/json' },
		body: JSON.stringify({ url }),
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || res.statusText);
	return data;
}

/**
 * On a Trakt list page: follow that list, so its titles, present and future,
 * are wanted. A non-sponsor gets a link to `/wanted`, which says what the list is.
 */
export default function FollowListButton({ url }: { url: string }) {
	const { isSponsor } = useSponsor();
	const [busy, setBusy] = useState(false);

	if (!isSponsor) {
		return (
			<Link href="/wanted" className={BUTTON} title="Sponsors can have zurg fetch this list">
				<BookmarkPlus className="mr-1 h-4 w-4" />
				Follow with Want
			</Link>
		);
	}

	const follow = async () => {
		setBusy(true);
		try {
			toast.success(followSummary(await followList(url)), { duration: 8000 });
		} catch (e) {
			toast.error(`Could not follow: ${e instanceof Error ? e.message : 'unreachable'}`, {
				duration: 8000,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			onClick={follow}
			disabled={busy}
			className={BUTTON}
			title="Add every title on this list to your wanted list, and new ones as they appear"
		>
			{busy ? (
				<Loader2 className="mr-1 h-4 w-4 animate-spin" />
			) : (
				<BookmarkPlus className="mr-1 h-4 w-4" />
			)}
			Follow with Want
		</button>
	);
}
