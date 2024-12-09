import { TraktUser } from '@/services/trakt';
import Link from 'next/link';

interface TraktSectionProps {
	traktUser: TraktUser | null;
}

export function TraktSection({ traktUser }: TraktSectionProps) {
	return (
		<div className="grid w-full grid-cols-2 gap-3">
			<Link
				href="/trakt/movies"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50"
			>
				🎥&nbsp;Movies
			</Link>
			<Link
				href="/trakt/shows"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50"
			>
				📺&nbsp;Shows
			</Link>
			{traktUser && (
				<div className="col-span-2 grid grid-cols-3 gap-3">
					<Link
						href="/trakt/watchlist"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50"
					>
						👀&nbsp;Watchlist
					</Link>
					<Link
						href="/trakt/collection"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50"
					>
						🗃️&nbsp;Collections
					</Link>
					<Link
						href="/trakt/mylists"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50"
					>
						🧏🏻‍♀️&nbsp;My lists
					</Link>
				</div>
			)}
		</div>
	);
}
