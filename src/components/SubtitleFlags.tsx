import { languageEmojis } from '@/components/showInfo/languages';

interface SubtitleFlagsProps {
	/** The release's tagged subtitle languages; undefined when it has no stored probe. */
	languages: readonly string[] | undefined;
	/** More than one video file: a flag then means one probed file had the track. */
	isPack: boolean;
}

/** The embedded subtitle languages of one search result, as flags. Nothing when unknown. */
export default function SubtitleFlags({ languages, isPack }: SubtitleFlagsProps) {
	if (!languages?.length) return null;
	const title = `Embedded subtitles: ${languages.join(', ')}${
		isPack ? ' (in at least one probed file of this pack)' : ''
	}`;
	return (
		<div className="text-xs text-gray-300" title={title} data-testid="subtitle-flags">
			<span className="mr-1">Subs:</span>
			{languages.map((language) => (
				<span key={language} className="mr-1" aria-label={language}>
					{languageEmojis[language] ?? language}
				</span>
			))}
		</div>
	);
}

interface SubtitleFilterSummaryProps {
	matches: number;
	unknown: number;
	checking: boolean;
}

/** "3 matches, 24 unknown" under a `subs:` filter, so an empty result is not read as "none have it". */
export function SubtitleFilterSummary({ matches, unknown, checking }: SubtitleFilterSummaryProps) {
	return (
		<div
			className="mb-2 text-xs text-gray-400"
			data-testid="subtitle-filter-summary"
			role="status"
		>
			{matches} {matches === 1 ? 'match' : 'matches'}, {unknown} unknown
			{checking && ' (checking subtitles…)'}
			<span
				className="ml-1 cursor-help underline decoration-dotted"
				title="Only releases some zurg user has analyzed have known subtitles. Untagged tracks and external .srt files are not counted."
			>
				why unknown?
			</span>
		</div>
	);
}
