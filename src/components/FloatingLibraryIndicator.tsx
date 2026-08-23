import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import {
	useAllDebridApiKey,
	usePremiumizeCredential,
	useRealDebridAccessToken,
	useTorBoxAccessToken,
} from '@/hooks/auth';
import { useRelativeTimeLabel } from '@/hooks/useRelativeTimeLabel';
import { AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function FloatingLibraryIndicator() {
	const { libraryItems, isLoading, isFetching, lastFetchTime, error, refreshLibrary } =
		useLibraryCache();
	const router = useRouter();
	const [rdToken] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const tbKey = useTorBoxAccessToken();
	const pmKey = usePremiumizeCredential();
	const [mounted, setMounted] = useState(false);
	const lastFetchLabel = useRelativeTimeLabel(lastFetchTime, 'Just now');

	// Handle client-side mounting to avoid hydration mismatch
	useEffect(() => {
		setMounted(true);
	}, []);

	// Derived, not stored. This used to be state fed by three racing sources -
	// a localStorage read on mount, storage/login/logout listeners, and an effect
	// syncing the hooks - where the last one could revive a logged-out session.
	// useLocalStorage already re-reads on its own events, so the tokens are
	// reactive and one expression is enough.
	const isLoggedIn = !!rdToken?.trim() || !!adKey?.trim() || !!tbKey?.trim() || !!pmKey?.trim();

	const handleRefresh = async () => {
		try {
			await refreshLibrary();
		} catch {
			// refreshLibrary rethrows; the context surfaces the failure through
			// `error` below, so swallow it here rather than leaving an unhandled
			// rejection from the click handler
		}
	};

	const isStale =
		lastFetchTime && new Date().getTime() - lastFetchTime.getTime() > 30 * 60 * 1000; // 30 minutes

	// Don't render until mounted to avoid hydration issues
	if (!mounted) {
		return null;
	}

	// Don't show if user is not logged in to any service
	if (!isLoggedIn) {
		return null;
	}

	// Don't show on library page
	if (router.pathname === '/library') {
		return null;
	}

	return (
		<div className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-full border border-gray-700 bg-gray-800 px-3 py-2 shadow-lg md:px-4 md:py-2">
			<div className="flex items-center gap-2">
				{error && (
					<div title={error}>
						<AlertCircle className="h-4 w-4 text-red-400" />
					</div>
				)}
				<div className="flex flex-col">
					<span className="text-sm text-gray-300">
						{isLoading || isFetching ? (
							<span className="text-cyan-400">
								{isLoading ? 'Loading...' : 'Refreshing...'}
							</span>
						) : (
							<Link href="/library">
								<div className="flex cursor-pointer items-center gap-1 transition-colors hover:text-cyan-400">
									<span className="font-medium text-white">
										{libraryItems.length}
									</span>
									<span className="hidden text-gray-400 sm:inline">items</span>
								</div>
							</Link>
						)}
					</span>
					{!isLoading && !isFetching && lastFetchTime && (
						<span
							className={`text-xs ${isStale ? 'text-yellow-400' : 'text-gray-500'} hidden sm:block`}
						>
							{lastFetchLabel}
						</span>
					)}
				</div>
				<button
					onClick={handleRefresh}
					disabled={isFetching || isLoading}
					className={`rounded-full p-1.5 transition-all ${
						isFetching || isLoading
							? 'cursor-not-allowed bg-gray-700 text-gray-500'
							: error
								? 'bg-red-900/50 text-red-400 hover:bg-red-800/50'
								: isStale
									? 'bg-yellow-900/50 text-yellow-400 hover:bg-yellow-800/50'
									: 'bg-cyan-900/50 text-cyan-400 hover:bg-cyan-800/50 hover:text-cyan-300'
					}`}
					title={error ? 'Retry fetch' : 'Refresh library'}
					aria-label="Refresh library"
				>
					<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
				</button>
			</div>
		</div>
	);
}
