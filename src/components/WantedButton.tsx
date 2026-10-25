import { sponsorHeaders, useSponsor } from '@/hooks/useSponsor';
import type { WantedItemResponse } from '@/pages/api/wanted';
import { BookmarkCheck, BookmarkPlus, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface WantedButtonProps {
	imdbId: string;
	kind: 'movie' | 'show';
	title: string;
	/** On a season page: want this season, beside the show's other wanted seasons. */
	season?: number;
}

const BUTTON =
	'mb-1 mr-2 mt-0 inline-block rounded border-2 border-rose-500 bg-rose-900/30 p-1 text-xs text-rose-100 transition-colors hover:bg-rose-800/50 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Puts a title on the sponsor's wanted list, which their zurg fetches. On a
 * season page it wants that season, keeping the others already wanted; a show
 * wanted whole stays whole. A non-sponsor gets a link to `/wanted`, which says
 * what the list is and how to get it.
 */
export default function WantedButton({ imdbId, kind, title, season }: WantedButtonProps) {
	const { isSponsor } = useSponsor();
	const [item, setItem] = useState<WantedItemResponse | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!isSponsor) return;
		let cancelled = false;
		fetch('/api/wanted', { headers: sponsorHeaders() })
			.then((res) => (res.ok ? res.json() : { items: [] }))
			.then((data: { items: WantedItemResponse[] }) => {
				if (!cancelled) setItem(data.items.find((i) => i.imdbId === imdbId) ?? null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [isSponsor, imdbId]);

	// A show's whole-show button is on only when every season is wanted.
	const wanted =
		!!item &&
		(kind === 'movie' ||
			item.seasons === null ||
			(season !== undefined && item.seasons.includes(season)));

	// Every season is wanted: the season button says so and leaves the change to the whole-show one.
	const coveredByAll = season !== undefined && item?.seasons === null;

	const toggle = useCallback(async () => {
		setBusy(true);
		try {
			let res: Response;
			let next: WantedItemResponse | null;
			const others = item?.seasons?.filter((s) => s !== season) ?? [];
			if (wanted && (season === undefined || item!.seasons === null || others.length === 0)) {
				res = await fetch(`/api/wanted?imdbId=${encodeURIComponent(imdbId)}`, {
					method: 'DELETE',
					headers: sponsorHeaders(),
				});
				next = null;
			} else {
				const seasons = season === undefined ? null : wanted ? others : [...others, season];
				res = await fetch('/api/wanted', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...sponsorHeaders() },
					body: JSON.stringify({ imdbId, kind, title, seasons }),
				});
				next = res.ok ? (await res.json()).item : item;
			}
			if (!res.ok) {
				const { error } = await res.json().catch(() => ({ error: '' }));
				toast.error(error || 'Could not update your wanted list');
				return;
			}
			setItem(next);
			toast.success(next ? 'Your wanted list is updated' : 'Removed from your wanted list');
		} catch {
			toast.error('Could not update your wanted list');
		} finally {
			setBusy(false);
		}
	}, [item, wanted, season, imdbId, kind, title]);

	const label =
		kind === 'movie'
			? wanted
				? 'Wanted'
				: 'Want'
			: season === undefined
				? wanted
					? 'Wanted: all seasons'
					: 'Want all seasons'
				: wanted
					? `Wanted: S${season}`
					: `Want S${season}`;

	if (!isSponsor) {
		return (
			<Link
				href="/wanted"
				className={BUTTON}
				title="Sponsors' zurg fetches titles from their wanted list"
			>
				<b className="flex items-center justify-center">
					<BookmarkPlus className="mr-1 h-3 w-3 text-rose-400" />
					{label}
				</b>
			</Link>
		);
	}

	return (
		<button
			className={BUTTON}
			onClick={toggle}
			disabled={busy || coveredByAll}
			aria-pressed={wanted}
			title={
				coveredByAll
					? 'Every season of this show is on your wanted list'
					: wanted
						? 'On your wanted list; click to remove'
						: 'Your zurg fetches what is on your wanted list'
			}
		>
			<b className="flex items-center justify-center">
				{busy ? (
					<Loader2 className="mr-1 h-3 w-3 animate-spin text-rose-400" />
				) : wanted ? (
					<BookmarkCheck className="mr-1 h-3 w-3 text-rose-400" />
				) : (
					<BookmarkPlus className="mr-1 h-3 w-3 text-rose-400" />
				)}
				{label}
			</b>
		</button>
	);
}
