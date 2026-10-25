import { SearchSourceStates, formatSourceLabel } from '@/utils/searchSources';
import { Check, Loader2, X } from 'lucide-react';
import { FunctionComponent } from 'react';

type Props = {
	sources: SearchSourceStates;
};

/**
 * "Searching 3/6" with a spinner, sized to sit in the results tab bar so the
 * page does not jump when it goes. Tapping it opens what each source has
 * contributed so far.
 */
const SearchSourceProgress: FunctionComponent<Props> = ({ sources }) => {
	const entries = Object.entries(sources);
	const finished = entries.filter(([, state]) => state.status !== 'loading').length;

	return (
		<details className="relative text-xs text-gray-100" data-testid="search-source-progress">
			<summary className="flex cursor-pointer list-none items-center px-1 py-1 font-bold whitespace-nowrap [&::-webkit-details-marker]:hidden">
				<Loader2 className="mr-1 h-3 w-3 animate-spin text-gray-400" />
				{entries.length === 0 ? 'Searching...' : `Searching ${finished}/${entries.length}`}
			</summary>
			{entries.length > 0 && (
				<div className="absolute right-0 z-20 mt-1 flex w-max max-w-[80vw] flex-col gap-1 rounded border border-gray-600 bg-gray-900 p-2 shadow-lg">
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
								{state.status === 'error' && (
									<X className="mr-1 h-3 w-3 text-red-500" />
								)}
								{label}
								{state.status !== 'error' && state.count > 0 && (
									<span className="ml-1 text-gray-400">{state.count}</span>
								)}
							</span>
						);
					})}
				</div>
			)}
		</details>
	);
};

export default SearchSourceProgress;
