import type { AnimeEntryLink } from '@/services/anime/animeEntries';
import Link from 'next/link';
import { FC } from 'react';

/** AniDB's types as a person reads them; the data spells them in capitals. */
export function animeTypeLabel(type: string | null | undefined): string {
	switch ((type ?? '').toUpperCase()) {
		case 'TV':
			return 'TV';
		case 'OVA':
			return 'OVA';
		case 'ONA':
			return 'ONA';
		case 'MOVIE':
			return 'Movie';
		case 'SPECIAL':
			return 'Special';
		default:
			return '';
	}
}

interface AnimeEntryLinksProps {
	entries: AnimeEntryLink[];
	/** The entry being viewed, drawn as the current one rather than as a link. */
	currentAnidbId?: number;
	/** Poster grids: at most three links, each one line. */
	compact?: boolean;
	label?: string;
}

const COMPACT_LIMIT = 3;

/**
 * Links to AniDB entries' anime pages, each labelled by the entry's title and
 * type. One IMDb show is usually several entries (Bookworm is five), so a show
 * page lists them all; a poster lists three and says how many more there are.
 */
const AnimeEntryLinks: FC<AnimeEntryLinksProps> = ({
	entries,
	currentAnidbId,
	compact = false,
	label = 'AniDB',
}) => {
	if (entries.length === 0) return null;
	const shown = compact ? entries.slice(0, COMPACT_LIMIT) : entries;
	const hidden = entries.length - shown.length;

	return (
		<div
			data-testid="anime-entry-links"
			className={`flex flex-wrap items-center gap-1 ${compact ? 'mt-1 text-[11px]' : 'text-xs'}`}
		>
			{!compact && <span className="mr-1 text-gray-300">{label}:</span>}
			{shown.map((entry) => {
				const type = animeTypeLabel(entry.type);
				const text = (
					<>
						<span className={compact ? 'truncate' : ''}>{entry.title}</span>
						{type && (
							<span className="ml-1 shrink-0 rounded bg-black/40 px-1 text-fuchsia-200">
								{type}
							</span>
						)}
					</>
				);
				if (entry.anidbId === currentAnidbId) {
					return (
						<span
							key={entry.anidbId}
							aria-current="page"
							title={entry.title}
							className="inline-flex max-w-full items-center rounded border-2 border-red-500 bg-red-900/30 px-1 py-0.5 text-red-100"
						>
							{text}
						</span>
					);
				}
				return (
					<Link
						key={entry.anidbId}
						href={`/anime/${entry.anidbId}`}
						title={type ? `${entry.title} (${type})` : entry.title}
						className={`inline-flex items-center rounded border border-fuchsia-500 bg-fuchsia-900/30 px-1 py-0.5 text-fuchsia-100 transition-colors hover:bg-fuchsia-800/50 ${compact ? 'w-full min-w-0' : 'max-w-full'}`}
					>
						{text}
					</Link>
				);
			})}
			{hidden > 0 && (
				<Link
					href={`/anime/${entries[0].anidbId}`}
					className="text-fuchsia-300 hover:underline"
					title="The first entry lists the whole franchise"
				>
					+{hidden} more
				</Link>
			)}
		</div>
	);
};

export default AnimeEntryLinks;
