import { FC } from 'react';

interface SearchTokensProps {
	title: string;
	year: string;
	isShow?: boolean;
	onTokenClick: (token: string) => void;
}

const SearchTokens: FC<SearchTokensProps> = ({ title, year, isShow = false, onTokenClick }) => {
	// Split title into words and filter out empty strings
	const titleWords = title
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word.length > 0);

	// Format season number as s01, s02, etc. if it's a show, or ensure year is a string
	const formattedYear = isShow ? `s${year.padStart(2, '0')}` : year.toString();

	// Add year/season as a token if it exists
	const tokens = [...new Set([...titleWords, formattedYear])];

	return (
		<div className="flex flex-row flex-wrap gap-1">
			{tokens.map((token, index) => (
				<span
					key={index}
					onClick={() => onTokenClick(token)}
					className="cursor-pointer whitespace-nowrap rounded border border-blue-500 bg-blue-900/30 px-2 py-0.5 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
				>
					{token}
				</span>
			))}
		</div>
	);
};

export default SearchTokens;
