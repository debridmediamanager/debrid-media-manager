import { TraktUser } from '@/services/trakt';
import { Archive, CalendarDays, Eye, Film, List, Tv } from 'lucide-react';
import Link from 'next/link';

interface TraktSectionProps {
	traktUser: TraktUser | null;
}

export function TraktSection({ traktUser }: TraktSectionProps) {
	const iconProps = { size: 16, strokeWidth: 2 };
	// Icons drop below 640px so each label fits a third of a phone's width
	const iconClass = 'hidden shrink-0 sm:block';

	return (
		<div className="grid w-full grid-cols-3 gap-3">
			<Link
				href="/trakt/movies"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-3 text-sm font-medium whitespace-nowrap text-red-100 transition-colors hover:bg-red-800/50 sm:p-3"
			>
				<Film {...iconProps} className={`${iconClass} text-yellow-400`} />
				Movies
			</Link>
			<Link
				href="/trakt/shows"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-3 text-sm font-medium whitespace-nowrap text-red-100 transition-colors hover:bg-red-800/50 sm:p-3"
			>
				<Tv {...iconProps} className={`${iconClass} text-cyan-400`} />
				Shows
			</Link>
			<Link
				href="/calendar"
				className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-3 text-sm font-medium whitespace-nowrap text-red-100 transition-colors hover:bg-red-800/50 sm:p-3"
			>
				<CalendarDays {...iconProps} className={`${iconClass} text-orange-300`} />
				Calendar
			</Link>
			{traktUser && (
				<div className="col-span-3 grid grid-cols-3 gap-3">
					<Link
						href="/trakt/watchlist"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-3 text-sm font-medium whitespace-nowrap text-red-100 transition-colors hover:bg-red-800/50 sm:p-3"
					>
						<Eye {...iconProps} className={`${iconClass} text-purple-400`} />
						Watchlist
					</Link>
					<Link
						href="/trakt/collection"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-3 text-sm font-medium whitespace-nowrap text-red-100 transition-colors hover:bg-red-800/50 sm:p-3"
					>
						<Archive {...iconProps} className={`${iconClass} text-blue-400`} />
						Collections
					</Link>
					<Link
						href="/trakt/mylists"
						className="haptic flex items-center justify-center gap-2 rounded border-2 border-red-500 bg-red-900/30 px-1 py-3 text-sm font-medium whitespace-nowrap text-red-100 transition-colors hover:bg-red-800/50 sm:p-3"
					>
						<List {...iconProps} className={`${iconClass} text-green-400`} />
						My lists
					</Link>
				</div>
			)}
		</div>
	);
}
