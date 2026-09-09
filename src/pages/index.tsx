import { BrowseSection } from '@/components/BrowseSection';
import { InfoSection } from '@/components/InfoSection';
import { Logo } from '@/components/Logo';
import { MainActions } from '@/components/MainActions';
import { SearchBar } from '@/components/SearchBar';
import { ServiceCard } from '@/components/ServiceCard';
import { TraktSection } from '@/components/TraktSection';
import { ZurgBanner } from '@/components/ZurgBanner';
import { useAllDebridCastToken } from '@/hooks/allDebridCastToken';
import { useCurrentUser, useDebridLogin } from '@/hooks/auth';
import { useCastToken } from '@/hooks/castToken';
import { useTorBoxCastToken } from '@/hooks/torboxCastToken';
import { getTerms } from '@/utils/browseTerms';
import { useGuestMode } from '@/utils/guestMode';
import { handleLogout } from '@/utils/logout';
import { checkPremiumStatus } from '@/utils/premiumCheck';
import { genericToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { Settings } from 'lucide-react';
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
		ocUser,
		dlUser,
		rdError,
		adError,
		tbError,
		pmError,
		ocError,
		dlError,
		traktUser,
		traktError,
		hasRDAuth,
		hasADAuth,
		hasTBAuth,
		hasPMAuth,
		hasOCAuth,
		hasDLAuth,
		hasTraktAuth,
		isLoading,
	} = useCurrentUser();
	const {
		loginWithRealDebrid,
		loginWithAllDebrid,
		loginWithTorbox,
		loginWithPremiumize,
		loginWithOffcloud,
		loginWithDebridLink,
	} = useDebridLogin();
	const isGuest = useGuestMode();
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
		(!hasOCAuth || !!ocUser || !!ocError) &&
		(!hasDLAuth || !!dlUser || !!dlError) &&
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
		// Every one of these points at the provider's own card, because that is
		// the only place sign-in and a single-provider logout exist. The two
		// destinations previously offered both dead-ended: Settings holds
		// playback and cast preferences and cannot show, replace or clear a
		// credential, and "clear site data" drops all seven accounts to fix one.
		//
		// Real-Debrid and Debrid-Link drop their own keys on a rejected
		// credential (`clearRdKeys` / `clearDlKeys`, both then setting error to
		// null), so those two only ever reach here on a transient failure and
		// Retry really is their answer. The other five park on the card until
		// the user acts, which is the case this whole flow was built for.
		if (rdError) {
			toast.error('Real-Debrid load failed. Use the Real-Debrid card below.');
		}
		if (adError) {
			toast.error('AllDebrid fetch failed. Use the AllDebrid card below.');
		}
		if (tbError) {
			toast.error('Torbox profile failed. Use the Torbox card below.');
		}
		if (pmError) {
			toast.error('Premiumize profile failed. Use the Premiumize card below.');
		}
		if (ocError) {
			toast.error('Offcloud profile failed. Use the Offcloud card below.');
		}
		if (dlError) {
			toast.error('Debrid-Link profile failed. Use the Debrid-Link card below.');
		}
		if (traktError) {
			toast.error('Trakt profile fetch failed. Use the Trakt card below.');
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
	}, [rdError, adError, tbError, pmError, ocError, dlError, traktError]);

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

	// The six provider cards, so guest mode can fold them away without the JSX
	// below having to exist twice.
	const debridServiceCards = (
		<>
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
				service="oc"
				error={ocError}
				user={ocUser}
				onTraktLogin={loginWithOffcloud}
				onLogout={async (prefix) => await handleLogout(prefix, router)}
			/>
			<ServiceCard
				service="dl"
				error={dlError}
				user={dlUser}
				onTraktLogin={loginWithDebridLink}
				onLogout={async (prefix) => await handleLogout(prefix, router)}
			/>
		</>
	);

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
						Debrid Media Manager
					</h1>

					<ZurgBanner />

					{/* Search Bar */}
					<div className="mb-4 w-full max-w-md">
						<SearchBar />
					</div>

					<div className="flex w-full max-w-md flex-col items-center gap-6">
						{isGuest && (
							<div className="w-full rounded border-2 border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-100">
								<p className="font-medium">You are browsing as a guest</p>
								<p className="mt-1 text-xs text-amber-200/80">
									Search, settings and the indexer setup pages are open. Your
									library, music, casting and transfers need a debrid account -
									connect one below whenever you want them.
								</p>
							</div>
						)}
						<MainActions
							rdUser={rdUser}
							tbUser={tbUser}
							adUser={!!adUser}
							pmUser={!!pmUser}
							ocUser={!!ocUser}
							dlUser={!!dlUser}
							isLoading={isLoading}
							isGuest={isGuest}
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
						<Link
							href="/newznab"
							className="haptic-sm flex w-full items-center justify-between rounded border-2 border-pink-500/40 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
						>
							<span className="flex items-center">
								<span
									aria-hidden="true"
									className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full bg-pink-400"
								/>
								Usenet Indexer
							</span>
							<span className="text-xs text-gray-400">
								Prowlarr-compatible endpoint for sponsors
							</span>
						</Link>
						<Link
							href="/jellyfin"
							className="haptic-sm flex w-full items-center justify-between rounded border-2 border-pink-500/40 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
						>
							<span className="flex items-center">
								<span
									aria-hidden="true"
									className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full bg-pink-400"
								/>
								Jellyfin plugins
							</span>
							<span className="text-xs text-gray-400">
								Your library in Jellyfin, for sponsors
							</span>
						</Link>
						<Link
							href="/torznab"
							className="haptic-sm flex w-full items-center justify-between rounded border-2 border-pink-500/40 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
						>
							<span className="flex items-center">
								<span
									aria-hidden="true"
									className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full bg-pink-400"
								/>
								Torrent Indexer
							</span>
							<span className="text-xs text-gray-400">
								DMM&apos;s library as a Torznab indexer, for sponsors
							</span>
						</Link>
						<BrowseSection terms={browseTerms} />
						<TraktSection traktUser={traktUser} />
						<div className="grid w-full grid-cols-1 gap-3">
							{/* A guest declined all six of these on the way in, so
							    they are folded away rather than dropped: the whole
							    point of guest mode is that connecting a service
							    later stays one click away. */}
							{isGuest ? (
								<details className="w-full rounded border-2 border-gray-500 bg-gray-800/30">
									<summary className="haptic-sm cursor-pointer px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50">
										Connect a debrid service
									</summary>
									<div className="grid grid-cols-1 gap-3 p-3 pt-0">
										{debridServiceCards}
									</div>
								</details>
							) : (
								debridServiceCards
							)}
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
							{/* One button, whoever is looking at it. Guest mode used
							    to have its own narrower exit next to this one, and
							    the pair read as the same action: both landed on
							    /start, and the difference - whether a linked DMM API
							    key survived - was invisible from the labels. */}
							<button
								onClick={async () => await handleLogout(undefined, router)}
								className={actionButtonClasses}
							>
								Clear browser data
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
