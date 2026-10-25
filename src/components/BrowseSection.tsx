import { getLocalStorageBoolean } from '@/utils/browserStorage';
import { Clapperboard, Clock3, Drama, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';

interface BrowseSectionProps {
	terms: string[];
}

export function BrowseSection({ terms }: BrowseSectionProps) {
	const router = useRouter();
	const [hideAnime] = useState(() => getLocalStorageBoolean('settings:hideAnime', false));
	const randomTerm = useMemo(() => terms[Math.floor(Math.random() * terms.length)], [terms]);

	const handleCustomSearch = () => {
		const term = prompt('Enter one word to browse:');
		if (term) {
			const cleanTerm = term.trim().replace(/\W/gi, '');
			if (cleanTerm) {
				router.push(`/browse/${cleanTerm}`);
			}
		}
	};

	return (
		// Wraps rather than scrolls: centring an overflowing row clipped the first chip
		// past the left edge with no way to scroll back to it.
		<div className="flex w-full flex-wrap items-center justify-center gap-2">
			<Link
				href="/browse"
				className="haptic-sm flex flex-1 items-center justify-center rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				<Drama className="mr-1 inline-block h-3 w-3 text-blue-500" />
				genres
			</Link>
			{!hideAnime && (
				<Link
					href="/anime"
					className="haptic-sm flex flex-1 items-center justify-center rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-800/50"
				>
					<Clapperboard className="mr-1 inline-block h-3 w-3 text-blue-500" />
					anime
				</Link>
			)}
			<Link
				href="/browse/recent"
				className="haptic-sm flex flex-1 items-center justify-center rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				<Clock3 className="mr-1 inline-block h-3 w-3 text-blue-500" />
				recent
			</Link>
			<Link
				href={`/browse/${randomTerm.replace(/\W/gi, '')}`}
				className="haptic-sm flex flex-1 items-center justify-center rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				{randomTerm}
			</Link>
			<button
				onClick={handleCustomSearch}
				className="haptic-sm flex flex-1 items-center justify-center rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				<Search className="mr-1 inline-block h-3 w-3 text-blue-500" />
				browse
			</button>
		</div>
	);
}
