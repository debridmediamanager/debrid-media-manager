import Poster from '@/components/poster';
import { useCachedList } from '@/hooks/useCachedList';
import { TraktMediaItem } from '@/services/trakt';
import { toasterPosition } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useMemo } from 'react';
import { Toaster } from 'react-hot-toast';

type Category = {
	name: string;
	results: Record<string, TraktMediaItem[]>;
};

type TraktBrowseProps = {
	mediaType: string;
	categories: Category[];
};

type RankedItem = {
	imdbid: string;
	title: string;
	year: number;
	dateTs: number;
	appearances: number;
};

// Sort key: movies use `released` (theatrical date), shows use `first_aired`
// (series premiere). Both come from Trakt's extended=full payload; fall back to
// the release year when the date is missing (e.g. a not-yet-refreshed cache).
function getDateTs(media: any): number {
	const raw = media?.released || media?.first_aired || null;
	const parsed = raw ? Date.parse(raw) : NaN;
	if (!isNaN(parsed)) return parsed;
	return media?.year ? Date.parse(`${media.year}-01-01`) : 0;
}

function rankItems(categories: Category[]): RankedItem[] {
	const map = new Map<string, RankedItem>();

	for (const category of categories) {
		for (const items of Object.values(category.results)) {
			for (const item of items) {
				// Endpoints return the media either wrapped (`{ ..., movie }`) or
				// as the bare object (e.g. movies/popular), so unwrap all shapes.
				const media = (item.movie || item.show || item) as any;
				const imdbid = media?.ids?.imdb;
				if (!imdbid) continue;

				const existing = map.get(imdbid);
				if (existing) {
					existing.appearances++;
				} else {
					map.set(imdbid, {
						imdbid,
						title: media?.title || 'Unknown',
						year: media?.year || 0,
						dateTs: getDateTs(media),
						appearances: 1,
					});
				}
			}
		}
	}

	// Already-released titles come first, newest → oldest. Upcoming titles
	// (e.g. Trakt's "Most Anticipated") have future dates, so they're bucketed to
	// the end, soonest → latest, instead of dominating the top. Popularity
	// (appearances across Trakt lists) breaks ties within each bucket.
	const now = Date.now();
	return Array.from(map.values()).sort((a, b) => {
		const aUpcoming = a.dateTs > now;
		const bUpcoming = b.dateTs > now;
		if (aUpcoming !== bUpcoming) return aUpcoming ? 1 : -1;
		if (aUpcoming) {
			return a.dateTs - b.dateTs || b.appearances - a.appearances;
		}
		return b.dateTs - a.dateTs || b.appearances - a.appearances;
	});
}

export const TraktBrowse: FunctionComponent = () => {
	const router = useRouter();
	const { browse } = router.query;
	const browseKey = typeof browse === 'string' ? browse : '';

	const { data, loading, error } = useCachedList<TraktBrowseProps>(
		browseKey ? `trakt:${browseKey}` : null,
		async () => {
			const response = await fetch(`/api/info/trakt?browse=${browseKey}`);
			if (!response.ok) {
				throw new Error('Failed to fetch data');
			}
			return response.json();
		}
	);

	const ranked = useMemo(() => (data ? rankItems(data.categories) : []), [data]);

	if (!browseKey || (loading && !data)) {
		return <div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">Loading...</div>;
	}

	if (error) {
		return (
			<div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">
				Error: Failed to load data
			</div>
		);
	}

	if (!data) {
		return (
			<div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">No data available</div>
		);
	}

	const title = data.mediaType === 'movie' ? 'Movies' : 'Shows';

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Trakt - {title}</title>
			</Head>
			<Toaster position={toasterPosition()} />

			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">Trakt - {title}</h1>
				<Link
					href="/"
					className="shrink-0 rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm whitespace-nowrap text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
				{ranked.map((item) => (
					<Link key={item.imdbid} href={`/${data.mediaType}/${item.imdbid}`}>
						<Poster imdbId={item.imdbid} title={item.title} />
					</Link>
				))}
			</div>
		</div>
	);
};

export default withAuth(TraktBrowse);
