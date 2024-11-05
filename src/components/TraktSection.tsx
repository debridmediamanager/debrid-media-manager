import { TraktUser } from '@/services/trakt';
import Link from 'next/link';

interface TraktSectionProps {
	traktUser: TraktUser | null;
}

export function TraktSection({ traktUser }: TraktSectionProps) {
	return (
		<div className="grid grid-cols-2 gap-3 w-full">
			<Link
				href="/trakt/movies"
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium haptic"
			>
				🎥 Movies
			</Link>
			<Link
				href="/trakt/shows"
				className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium haptic"
			>
				📺 Shows
			</Link>
			{traktUser && (
				<>
					<Link
						href="/trakt/watchlist"
						className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium haptic"
					>
						👀 Watchlist
					</Link>
					<Link
						href="/trakt/collection"
						className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium haptic"
					>
						🗃️ Collections
					</Link>
					<Link
						href="/trakt/mylists"
						className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium haptic"
					>
						🧏🏻‍♀️ My lists
					</Link>
				</>
			)}
		</div>
	);
}
