import { useState } from 'react';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';

interface ExpandableDescriptionProps {
	description: string;
	imdbScore?: number;
	imdbId?: string;
	className?: string;
}

const ExpandableDescription: React.FC<ExpandableDescriptionProps> = ({
	description,
	imdbScore,
	imdbId,
	className = '',
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const shouldTruncate = description.length > 150;
	const displayText =
		isExpanded || !shouldTruncate ? description : description.substring(0, 150) + '...';

	return (
		<div className={`h-fit w-fit rounded bg-slate-900/75 p-2 ${className}`}>
			<span className={shouldTruncate && !isExpanded ? 'line-clamp-3' : ''}>
				{displayText}
			</span>
			{imdbScore && imdbScore > 0 && (
				<div className="ml-2 inline text-yellow-100">
					<a
						href={`https://www.imdb.com/title/${imdbId}/`}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:underline"
					>
						IMDB Score: {imdbScore < 10 ? imdbScore : imdbScore / 10}
					</a>
				</div>
			)}
			{shouldTruncate && (
				<button
					onClick={() => setIsExpanded(!isExpanded)}
					className="mt-2 flex items-center gap-1 text-sm text-cyan-400 transition-colors hover:text-cyan-300"
					aria-expanded={isExpanded}
					aria-label={isExpanded ? 'Show less' : 'Show more'}
				>
					{isExpanded ? (
						<>
							Show less <FaChevronUp className="h-3 w-3" />
						</>
					) : (
						<>
							Show more <FaChevronDown className="h-3 w-3" />
						</>
					)}
				</button>
			)}
		</div>
	);
};

export default ExpandableDescription;
