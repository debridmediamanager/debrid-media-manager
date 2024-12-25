import Link from 'next/link';
import { useRouter } from 'next/router';

interface BrowseSectionProps {
	terms: string[];
}

export function BrowseSection({ terms }: BrowseSectionProps) {
	const router = useRouter();
	const randomTerm = terms[Math.floor(Math.random() * terms.length)];

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
		<div className="flex w-full items-center justify-center gap-2 overflow-x-auto pb-2">
			<Link
				href="/browse"
				className="haptic-sm flex-1 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				🎭&nbsp;genres
			</Link>
			<Link
				href="/browse/recent"
				className="haptic-sm flex-1 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				⏰&nbsp;recent
			</Link>
			<Link
				href={`/browse/${randomTerm.replace(/\W/gi, '')}`}
				className="haptic-sm flex-1 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				{randomTerm}
			</Link>
			<button
				onClick={handleCustomSearch}
				className="haptic-sm flex-1 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				🔍&nbsp;browse
			</button>
		</div>
	);
}
