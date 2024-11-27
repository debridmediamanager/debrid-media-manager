import { BrowseSection } from '@/components/BrowseSection';
import { InfoSection } from '@/components/InfoSection';
import { Logo } from '@/components/Logo';
import { MainActions } from '@/components/MainActions';
import { SearchBar } from '@/components/SearchBar';
import { ServiceCard } from '@/components/ServiceCard';
import { TraktSection } from '@/components/TraktSection';
import { useCurrentUser, useDebridLogin } from '@/hooks/auth';
import { getTerms } from '@/utils/browseTerms';
import { handleLogout } from '@/utils/logout';
import { checkPremiumStatus } from '@/utils/premiumCheck';
import { showSettings } from '@/utils/settings';
import { genericToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';

function IndexPage() {
	const router = useRouter();
	const {
		rdUser,
		adUser,
		tbUser,
		rdError,
		adError,
		tbError,
		traktUser,
		traktError,
		hasRDAuth,
		hasADAuth,
		hasTBAuth,
		hasTraktAuth,
	} = useCurrentUser();
	const { loginWithRealDebrid, loginWithAllDebrid, loginWithTorbox } = useDebridLogin();
	const [browseTerms] = useState(getTerms(2));

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
			toast.error(
				'Real-Debrid get user info failed, try clearing DMM site data and login again'
			);
		}
		if (adError) {
			toast.error(
				'AllDebrid get user info failed, check your email and confirm the login coming from DMM'
			);
		}
		if (tbError) {
			toast.error('Torbox get user info failed, please check your API key');
		}
		if (traktError) {
			toast.error('Trakt get user info failed');
		}
		if (localStorage.getItem('next_action') === 'clear_cache') {
			localStorage.removeItem('next_action');
			const request = window.indexedDB.deleteDatabase('DMMDB');
			request.onsuccess = function () {
				window.location.assign('/');
			};
			request.onerror = function () {
				toast.error('Database deletion failed', genericToastOptions);
			};
			request.onblocked = function () {
				toast(
					'Database is still open, refresh the page first and then try deleting again',
					genericToastOptions
				);
			};
		}
	}, [rdError, adError, tbError, traktError]);

	useEffect(() => {
		if (rdUser) {
			checkPremiumStatus(rdUser).then(({ shouldLogout }) => {
				if (shouldLogout) {
					handleLogout('rd:', router);
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
		window.location.reload();
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Home</title>
				<meta name="robots" content="index, nofollow" />
			</Head>
			<Logo />
			<Toaster position="bottom-right" />
			{(rdUser || !hasRDAuth) &&
			(adUser || !hasADAuth) &&
			(tbUser || !hasTBAuth) &&
			(traktUser || !hasTraktAuth) ? (
				<>
					<h1 className="mb-2 text-xl font-bold text-white">
						Debrid Media Manager{' '}
						<a
							href="https://www.patreon.com/debridmediamanager"
							className="text-2xl hover:opacity-75"
						>
							📣
						</a>
					</h1>

					{/* Search Bar */}
					<div className="mb-6 w-full max-w-md">
						<SearchBar />
					</div>

					<div className="flex w-full max-w-md flex-col items-center gap-6">
						<MainActions rdUser={rdUser} showSettings={showSettings} />
						<BrowseSection terms={browseTerms} />
						<TraktSection traktUser={traktUser} />
						<div className="grid w-full grid-cols-1 gap-3">
							<ServiceCard
								service="rd"
								user={rdUser}
								onTraktLogin={loginWithRealDebrid}
								onLogout={(prefix) => handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="ad"
								user={adUser}
								onTraktLogin={loginWithAllDebrid}
								onLogout={(prefix) => handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="tb"
								user={tbUser}
								onTraktLogin={loginWithTorbox}
								onLogout={(prefix) => handleLogout(prefix, router)}
							/>
							<ServiceCard
								service="trakt"
								user={traktUser}
								onTraktLogin={loginWithTrakt}
								onLogout={(prefix) => handleLogout(prefix, router)}
							/>
						</div>
						<InfoSection />

						{/* Action Buttons */}
						<div className="flex flex-wrap justify-center gap-2">
							<button
								onClick={() => handleClearCache()}
								className="haptic-sm rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
							>
								Clear library cache
							</button>
							<button
								onClick={() => handleLogout(undefined, router)}
								className="haptic-sm rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
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
					<button
						onClick={handleClearLocalStorage}
						className="haptic-sm rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
					>
						Clear Data and Reload
					</button>
				</div>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
