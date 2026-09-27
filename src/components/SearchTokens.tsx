import { FC, useMemo } from 'react';

interface SearchTokensProps {
	title: string;
	year: string;
	isShow?: boolean;
	onTokenClick: (token: string) => void;
}

/**
 * Make non-alphanumeric characters optional in the regex filter value
 * e.g. "spider-man" → "spider-?man", "re:coded" → "re:?coded"
 */
function makeSymbolsOptional(word: string): string {
	return word.replace(/([^a-z0-9])/g, '$1?');
}

interface Token {
	display: string;
	filter: string;
}

const SearchTokens: FC<SearchTokensProps> = ({ title, year, isShow = false, onTokenClick }) => {
	const tokens: Token[] = useMemo(() => {
		// Split title into words and filter out empty strings
		const titleWords = title
			.toLowerCase()
			.replace(/:/g, '')
			.split(/\s+/)
			.filter((word) => word.length > 0);

		// Format season number as s01, s02, etc. if it's a show
		const formattedYear = isShow ? `s${year.padStart(2, '0')}` : year.toString();

		// Deduplicate. An anime entry has no year or season token to offer.
		const unique = [...new Set([...titleWords, formattedYear])].filter((word) => word !== '');

		return unique.map((word) => ({
			display: word,
			filter: makeSymbolsOptional(word),
		}));
	}, [title, year, isShow]);

	return (
		<div className="flex flex-row flex-wrap gap-1">
			{tokens.map((token, index) => (
				<span
					key={index}
					onClick={() => onTokenClick(token.filter)}
					className="cursor-pointer whitespace-nowrap rounded border border-blue-500 bg-blue-900/30 px-2 py-0.5 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
				>
					{token.display}
				</span>
			))}
		</div>
	);
};

export default SearchTokens;
