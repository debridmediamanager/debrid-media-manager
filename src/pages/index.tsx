import { BrowseSection } from '@/components/BrowseSection';
import { InfoSection } from '@/components/InfoSection';
import { Logo } from '@/components/Logo';
import { MainActions } from '@/components/MainActions';
import { SearchBar } from '@/components/SearchBar';
import { ServiceCard } from '@/components/ServiceCard';
import { TraktSection } from '@/components/TraktSection';
import { useAllDebridCastToken } from '@/hooks/allDebridCastToken';
import { useCurrentUser, useDebridLogin } from '@/hooks/auth';
import { useCastToken } from '@/hooks/castToken';
import { useTorBoxCastToken } from '@/hooks/torboxCastToken';
import { getTerms } from '@/utils/browseTerms';
import { handleLogout } from '@/utils/logout';
import { checkPremiumStatus } from '@/utils/premiumCheck';
import { genericToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { Megaphone, Settings } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';

const PROFILE_WAIT_MS = 5000;

function IndexPage() {
	const router = useRouter();
	const {
		rdUser,
		adUser,
		tbUser,
		pmUser,
		rdError,
		adError,
		tbError,
		pmError,
		traktUser,
		traktError,
		hasRDAuth,
		hasADAuth,
		hasTBAuth,
		hasPMAuth,
		hasTraktAuth,
		isLoading,
	} = useCurrentUser();
	const { loginWithRealDebrid, loginWithAllDebrid, loginWithTorbox, loginWithPremiumize } =
		useDebridLogin();
	const [browseTerms] = useState(getTerms(2));

	// A provider has settled once it has answered - either a profile or an
	// error. The page used to wait for every configured provider to *succeed*,
	// which made a failed provider indistinguishable from one still in flight;
	// since nothing retries, that wait never ended and the page sat on
	// "Debrid Media Manager is loading..." for good.
	const servicesSettled =
		(!hasRDAuth || !!rdUser || !!rdError) &&
		(!hasADAuth || !!adUser || !!adError) &&
		(!hasTBAuth || !!tbUser || !!tbError) &&
		(!hasPMAuth || !!pmUser || !!pmError) &&
		(!hasTraktAuth || !!traktUser || !!traktError);

	// Settling still depends on a promise resolving, and a provider can park one
	// for minutes - TorBox answers a 429 by pausing every one of its calls for
	// five. Bound the wait: a profile that never arrives degrades to that one
	// service looking disconnected, which beats a page that never appears.
	const [profileWaitElapsed, setProfileWaitElapsed] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setProfileWaitElapsed(true), PROFILE_WAIT_MS);
		return () => clearTimeout(timer);
	}, []);

	// Each of these no-ops without that service's credentials. They also resync the
	// cast profile, so settings that failed to reach the server heal on any visit
	// instead of only on the service's own cast page.
	useCastToken();
	useAllDebridCastToken();
	useTorBoxCastToken();

	// Loading state tracking
	useEffect(() => {
		// Loading state managed by auth system
	}, [isLoading]);

	useEffect(() => {
		if (typeof window !== 'undefined') {
			(window as any).registerMagnetHandler = () => {
				if ('registerProtocolHandler' in navigator) {
					try {
						navigator.registerProtocolHandler(
							'magnet',
							`${window.location.origin}/library?addMagnet=%s`
						);
					} catch (error) {
						console.error('Error registering protocol handler:', error);
					}
				}
			};
		}
	}, []);

	useEffect(() => {
		if (rdError) {
			toast.error('RD load failed. Clear site data and sign in again.');
		}
		if (adError) {
			toast.error('AllDebrid fetch failed. Confirm your DMM login email.');
		}
		if (tbError) {
			toast.error('Torbox profile failed. Verify the API key in Settings.');
		}
		if (pmError) {
			toast.error('Premiumize profile failed. Verify the API key in Settings.');
		}
		if (traktError) {
			toast.error('Trakt profile fetch failed.');
		}
		if (localStorage.getItem('next_action') === 'clear_cache') {
			localStorage.removeItem('next_action');
			const request = window.indexedDB.deleteDatabase('DMMDB');
			request.onsuccess = function () {
				window.location.assign('/');
			};
			request.onerror = function () {
				toast.error('Failed to delete local cache.', genericToastOptions);
			};
			request.onblocked = function () {
				toast('Local DB still open. Refresh and retry.', genericToastOptions);
			};
		}
	}, [rdError, adError, tbError, pmError, traktError]);

	useEffect(() => {
		if (rdUser) {
			checkPremiumStatus(rdUser).then(async ({ shouldLogout }) => {
				if (shouldLogout) {
					await handleLogout('rd:', router);
				}
			});
		}
	}, [rdUser, router]);

	const loginWithTrakt = async () => {
		const authUrl = `/api/trakt/auth?redirect=${window.location.origin}`;
		router.push(authUrl);
	};

	const handleClearCache = async () => {
		localStorage.setItem('next_action', 'clear_cache');
		window.location.assign('/');
	};

	const handleClearLocalStorage = () => {
		localStorage.clear();
		// Dispatch logout event to update UI immediately
		window.dispatchEvent(new Event('logout'));
		window.location.reload();
	};

	const actionButtonGroupClasses = 'grid w-full max-w-md gap-3 sm:grid-cols-2 md:grid-cols-3';
	const actionButtonClasses =
		'haptic-sm w-full rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50';

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Home</title>
				<meta name="robots" content="index, nofollow" />
			</Head>
			<Logo />
			<Toaster position="bottom-right" />
			{servicesSettled || profileWaitElapsed ? (
				<>
					<h1 className="mb-2 flex items-center justify-center text-xl font-bold text-white">
						Debrid Media Manager{' '}
						<a
							href="https://www.patreon.com/debridmediamanager"
							className="ml-2 inline-flex hover:opacity-75"
						>
							<Megaphone className="h-6 w-6 text-yellow-400" />
						</a>
					</h1>

					{/* Search Bar */}
					<div className="mb-4 w-full max-w-md">
						<SearchBar />
					</div>

					<div className="flex w-full max-w-md flex-col items-center gap-6">
						<MainActions
							rdUser={rdUser}
							tbUser={tbUser}
							adUser={!!adUser}
							pmUser={!!pmUser}
							isLoading={isLoading}
						/>
						<Link
							href="/settings"
							className="haptic-sm flex w-full items-center justify-between rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
						>
							<span className="flex items-center">
								<Settings className="mr-2 inline-block h-4 w-4 text-gray-400" />
								Settings
							</span>
							<span className="text-xs text-gray-400">Open full page</span>
						</Link>
						<BrowseSection terms={browseTerms} />
						<TraktSection traktUser={traktUser} />
						<div className="grid w-full grid-cols-1 gap-3">
							<ServiceCard
								service="rd"
								error={rdError}
								user={rdUser}
								onTraktLogin={loginWithRealDebrid}
								onLogout={async (prefix) => await handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="ad"
								error={adError}
								user={adUser}
								onTraktLogin={loginWithAllDebrid}
								onLogout={async (prefix) => await handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="tb"
								error={tbError}
								user={tbUser}
								onTraktLogin={loginWithTorbox}
								onLogout={async (prefix) => await handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="pm"
								error={pmError}
								user={pmUser}
								onTraktLogin={loginWithPremiumize}
								onLogout={async (prefix) => await handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="trakt"
								error={traktError}
								user={traktUser}
								onTraktLogin={loginWithTrakt}
								onLogout={async (prefix) => await handleLogout(prefix, router)}
							/>
						</div>
						<InfoSection />

						{/* Action Buttons */}
						<div className={actionButtonGroupClasses}>
							<button
								onClick={() => window.location.reload()}
								className={actionButtonClasses}
							>
								↻&nbsp;Refresh
							</button>
							<button
								onClick={() => handleClearCache()}
								className={actionButtonClasses}
							>
								Clear library cache
							</button>
							<button
								onClick={async () => await handleLogout(undefined, router)}
								className={actionButtonClasses}
							>
								Logout All
							</button>
						</div>
					</div>
				</>
			) : (
				<div className="flex flex-col items-center gap-4">
					<h1 className="pb-4 text-center text-xl text-white">
						Debrid Media Manager is loading...
					</h1>
					<div className={actionButtonGroupClasses}>
						<button onClick={handleClearLocalStorage} className={actionButtonClasses}>
							Clear Data and Reload
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
