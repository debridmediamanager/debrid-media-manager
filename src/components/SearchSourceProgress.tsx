import { SearchSourceStates, formatSourceLabel } from '@/utils/searchSources';
import { Check, Loader2, X } from 'lucide-react';
import { FunctionComponent } from 'react';

type Props = {
	sources: SearchSourceStates;
};

/**
 * Replaces the old "Loading..." bar: same white-on-black strip, but it names
 * every source the search is waiting on and what each one contributed.
 */
const SearchSourceProgress: FunctionComponent<Props> = ({ sources }) => {
	const entries = Object.entries(sources);
	if (entries.length === 0) {
		return <div className="flex items-center justify-center bg-black">Loading...</div>;
	}

	const finished = entries.filter(([, state]) => state.status !== 'loading').length;

	return (
		<div
			className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-black px-2 py-1 text-xs text-gray-100"
			data-testid="search-source-progress"
		>
			<span className="whitespace-nowrap font-bold">
				Searching {finished}/{entries.length}
			</span>
			{entries.map(([source, state]) => {
				const label = formatSourceLabel(source);
				return (
					<span
						key={source}
						data-testid={`search-source-${source}`}
						title={
							state.status === 'error'
								? `${label} failed`
								: state.status === 'done' && state.count === 0
									? `${label}: nothing new (or unreachable)`
									: `${label}: ${state.count} unique result${state.count === 1 ? '' : 's'}`
						}
						className={`inline-flex items-center whitespace-nowrap ${
							state.status === 'loading' ? 'text-gray-400' : 'text-gray-100'
						}`}
					>
						{state.status === 'loading' && (
							<Loader2 className="mr-1 h-3 w-3 animate-spin text-gray-400" />
						)}
						{/* green only when the source actually contributed - addons that
						    fail are swallowed into an empty list, so a bare finish is
						    "nothing from here", not a confirmed success */}
						{state.status === 'done' && (
							<Check
								className={`mr-1 h-3 w-3 ${
									state.count > 0 ? 'text-green-500' : 'text-gray-500'
								}`}
							/>
						)}
						{state.status === 'error' && <X className="mr-1 h-3 w-3 text-red-500" />}
						{label}
						{state.status !== 'error' && state.count > 0 && (
							<span className="ml-1 text-gray-400">{state.count}</span>
						)}
					</span>
				);
			})}
		</div>
	);
};

export default SearchSourceProgress;
