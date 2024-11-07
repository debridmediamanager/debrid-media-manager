import Link from 'next/link';

interface BrowseSectionProps {
	terms: string[];
}

export function BrowseSection({ terms }: BrowseSectionProps) {
	return (
		<div className="flex flex-wrap justify-center gap-2">
			<Link
				href="/browse"
				className="haptic-sm rounded border-2 border-blue-500 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				🏆 top
			</Link>
			<Link
				href="/browse/recent"
				className="haptic-sm rounded border-2 border-blue-500 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
			>
				⏰ recent
			</Link>
			{terms.map((term) => (
				<Link
					key={term}
					href={`/browse/${term.replace(/\W/gi, '')}`}
					className="haptic-sm rounded border-2 border-blue-500 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-800/50"
				>
					{term}
				</Link>
			))}
		</div>
	);
}
