import Link from 'next/link';

interface BrowseSectionProps {
	terms: string[];
}

export function BrowseSection({ terms }: BrowseSectionProps) {
	return (
		<div className="flex flex-wrap justify-center gap-2">
			<Link
				href="/browse"
				className="px-4 py-2 rounded border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors text-sm font-medium haptic-sm"
			>
				🏆 top
			</Link>
			<Link
				href="/browse/recent"
				className="px-4 py-2 rounded border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors text-sm font-medium haptic-sm"
			>
				⏰ recent
			</Link>
			{terms.map((term) => (
				<Link
					key={term}
					href={`/browse/${term.replace(/\W/gi, '')}`}
					className="px-4 py-2 rounded border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors text-sm font-medium haptic-sm"
				>
					{term}
				</Link>
			))}
		</div>
	);
}
