import { formatSize } from '@/components/UsenetResults';
import useLocalStorage from '@/hooks/localStorage';
import type { EasynewsCredentials, EasynewsResult } from '@/services/easynews';
import { Copy, Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

type EasynewsResultsProps = {
	title?: string;
	/** A film's year; absent for a show. */
	year?: string;
	/** Present for a show season, absent for a movie. */
	seasonNum?: number;
	/** Keeps only the rows whose title passes, e.g. the season page's episode chip. */
	rowFilter?: (title: string) => boolean;
};

async function post<T>(url: string, body: object): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(data?.error || `Easynews request failed (${response.status})`);
	return data as T;
}

// Easynews beside the shared indexers, searched with the visitor's own account:
// Easynews forbids sharing one. Its files download straight from Easynews, so
// unlike the rows above nothing goes through nzb2rd or Real-Debrid.
const EasynewsResults = ({ title, year, seasonNum, rowFilter }: EasynewsResultsProps) => {
	const [account, setAccount] = useLocalStorage<EasynewsCredentials>('en:account');
	const [results, setResults] = useState<EasynewsResult[] | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [linking, setLinking] = useState<string | null>(null);
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	// What the shown results were searched for, so saving a login that has just
	// searched does not search again: Easynews serves two searches at a time per account.
	const searchedFor = useRef<string | null>(null);
	const searchKey = (user: string) => JSON.stringify([user, title, year, seasonNum]);

	const search = useCallback(
		async (credentials: EasynewsCredentials) => {
			// The season page reads its number off the route, NaN on the first render.
			if (!title || (seasonNum !== undefined && !Number.isInteger(seasonNum))) return false;
			setIsLoading(true);
			setError(null);
			try {
				const data = await post<{ results: EasynewsResult[] }>('/api/easynews/search', {
					...credentials,
					title,
					year,
					seasonNum,
				});
				setResults(Array.isArray(data?.results) ? data.results : []);
				return true;
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Easynews search failed');
				setResults(null);
				return false;
			} finally {
				setIsLoading(false);
			}
		},
		[title, year, seasonNum]
	);

	useEffect(() => {
		if (!account || searchedFor.current === searchKey(account.username)) return;
		searchedFor.current = searchKey(account.username);
		search(account);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [account?.username, title, year, seasonNum]);

	const shown = useMemo(
		() => (results && rowFilter ? results.filter((r) => rowFilter(r.title)) : (results ?? [])),
		[results, rowFilter]
	);

	const signIn = async (e: React.FormEvent) => {
		e.preventDefault();
		const credentials = { username: username.trim(), password };
		// Kept only once Easynews has accepted it, so a typo is not saved.
		if (await search(credentials)) {
			searchedFor.current = searchKey(credentials.username);
			setAccount(credentials);
			setPassword('');
		}
	};

	// A fresh signed link per click: it carries no login, and Easynews mints a new
	// one every time, so there is nothing worth keeping.
	const withLink = async (
		result: EasynewsResult,
		handle: (url: string) => void | Promise<void>
	) => {
		if (!account || linking) return;
		setLinking(result.path);
		try {
			const { url } = await post<{ url: string }>('/api/easynews/link', {
				...account,
				path: result.path,
			});
			await handle(url);
		} catch (e) {
			toast.error(`Easynews: ${e instanceof Error ? e.message : 'no link'}`);
		} finally {
			setLinking(null);
		}
	};

	if (!title) return null;

	return (
		<div className="mx-2 my-4 rounded border border-gray-700 bg-gray-800/30">
			<h2 className="flex w-full items-center gap-2 px-4 py-3 text-left font-medium text-gray-100">
				<span>Download from your Easynews account</span>
				{results !== null && (
					<span className="text-sm text-gray-400">
						{rowFilter && shown.length !== results.length
							? `(${shown.length} of ${results.length})`
							: `(${results.length})`}
					</span>
				)}
				{isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
				{account && (
					<button
						type="button"
						onClick={() => {
							searchedFor.current = null;
							setAccount(null);
							setResults(null);
						}}
						className="ml-auto text-xs font-normal text-gray-400 hover:text-gray-100"
					>
						Sign out
					</button>
				)}
			</h2>

			<div className="border-t border-gray-700 px-2 pb-2">
				{!account && (
					<form
						onSubmit={signIn}
						className="flex flex-wrap items-center gap-2 px-2 py-3 text-sm"
					>
						<p className="w-full text-gray-400">
							Sign in with your own Easynews account to search it here too. Your login
							is kept in this browser only.
						</p>
						<input
							aria-label="Easynews username"
							placeholder="Username"
							autoComplete="username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-100"
						/>
						<input
							aria-label="Easynews password"
							placeholder="Password"
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-100"
						/>
						<button
							type="submit"
							disabled={!username.trim() || !password || isLoading}
							className="haptic rounded border border-gray-500 px-2 py-1 text-gray-100 hover:bg-gray-700/50 disabled:opacity-60"
						>
							Sign in
						</button>
					</form>
				)}

				{error && (
					<div className="flex items-center gap-3 px-2 py-3 text-sm text-red-300">
						<span>{error}</span>
						{account && (
							<button
								type="button"
								onClick={() => search(account)}
								className="haptic rounded border border-gray-500 px-2 py-1 text-gray-100 hover:bg-gray-700/50"
							>
								Retry
							</button>
						)}
					</div>
				)}

				{account && !isLoading && !error && results?.length === 0 && (
					<p className="px-2 py-3 text-sm text-gray-400">No Easynews results found.</p>
				)}

				{account && !isLoading && !error && !!results?.length && shown.length === 0 && (
					<p className="px-2 py-3 text-sm text-gray-400">
						None of the {results.length} Easynews results match the episode picked
						above.
					</p>
				)}

				{account && !isLoading && !error && shown.length > 0 && (
					<div className="overflow-x-auto">
						<table className="w-full table-auto text-sm">
							<thead>
								<tr className="text-left text-gray-400">
									<th className="px-2 py-2">Release</th>
									<th className="w-28 px-2 py-2">Size</th>
									<th className="w-40 px-2 py-2"></th>
								</tr>
							</thead>
							<tbody>
								{shown.map((result) => (
									<tr
										key={result.path}
										className="border-t border-gray-700/60 align-top"
									>
										<td className="px-2 py-2 break-all text-gray-100">
											{result.title}
										</td>
										<td className="px-2 py-2 whitespace-nowrap text-gray-300">
											{formatSize(result.size)}
										</td>
										<td className="px-2 py-2">
											<div className="flex items-stretch gap-1">
												<button
													type="button"
													onClick={() =>
														withLink(result, (url) =>
															window.location.assign(url)
														)
													}
													disabled={linking !== null}
													className="haptic flex flex-1 items-center gap-1 rounded border border-gray-500 bg-gray-800/60 px-2 py-1 text-gray-100 hover:bg-gray-700/50 disabled:opacity-60"
												>
													{linking === result.path ? (
														<Loader2 className="h-3 w-3 shrink-0 animate-spin" />
													) : (
														<Download className="h-3 w-3 shrink-0" />
													)}
													Download
												</button>
												{/* For a player such as VLC, which streams it as it downloads. */}
												<button
													type="button"
													onClick={() =>
														withLink(result, async (url) => {
															await navigator.clipboard.writeText(
																url
															);
															toast.success('Easynews link copied');
														})
													}
													disabled={linking !== null}
													title="Copy a link to play in VLC or another player"
													aria-label={`Copy Easynews link for ${result.title}`}
													className="haptic flex shrink-0 items-center rounded border border-gray-500 bg-gray-800/60 px-2 text-gray-100 hover:bg-gray-700/50 disabled:opacity-60"
												>
													<Copy className="h-3.5 w-3.5" />
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
};

export default EasynewsResults;
