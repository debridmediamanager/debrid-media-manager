import { Magnet, Newspaper } from 'lucide-react';
import Link from 'next/link';

interface ResultsTabsProps {
	/** The torrent page, `/movie/tt…` or `/show/tt…/N`. Usenet's is it plus `/usenet`. */
	basePath: string;
	active: 'torrents' | 'usenet';
	/** Carried to the other tab, e.g. the season page's `episode` chip. */
	query?: Record<string, string>;
}

const TAB =
	'haptic-sm flex items-center rounded-t border-2 border-b-0 px-3 py-1 text-sm transition-colors';

/**
 * Torrents | Usenet above a title's results. Each is its own route so a Usenet
 * search is linkable and the indexers are only asked when someone opens it: the
 * Usenet indexer bills a daily API-call quota.
 */
export default function ResultsTabs({ basePath, active, query }: ResultsTabsProps) {
	// The Torrents tab says so in its URL, or a viewer whose results open on
	// Usenet would be sent straight back there.
	const href = (path: string, extra: Record<string, string> = {}) => {
		const params = new URLSearchParams({ ...query, ...extra }).toString();
		return params ? `${path}?${params}` : path;
	};
	return (
		<nav className="mt-3 flex gap-1 border-b-2 border-gray-700" aria-label="Results">
			<Link
				href={href(basePath, { tab: 'torrents' })}
				aria-current={active === 'torrents' ? 'page' : undefined}
				className={`${TAB} ${active === 'torrents' ? 'border-gray-600 bg-gray-800 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
			>
				<Magnet className="mr-1 h-4 w-4" />
				Torrents
			</Link>
			<Link
				href={href(`${basePath}/usenet`)}
				aria-current={active === 'usenet' ? 'page' : undefined}
				className={`${TAB} ${active === 'usenet' ? 'border-gray-600 bg-gray-800 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
			>
				<Newspaper className="mr-1 h-4 w-4" />
				Usenet
			</Link>
		</nav>
	);
}
