import { useCurrentUser } from '@/hooks/auth';
import { getTerms } from '@/utils/browseTerms';
import { showSettings } from '@/utils/settings';
import { genericToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Swal from 'sweetalert2';

function IndexPage() {
	const router = useRouter();
	const { rdUser, adUser, rdError, adError, traktUser, traktError } = useCurrentUser();
	const [deleting, setDeleting] = useState(false);
	const [browseTerms] = useState(getTerms(2));
	const [lastPremiumWarning, setLastPremiumWarning] = useState<number>(0);

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
		if (traktError) {
			toast.error('Trakt get user info failed');
		}
		if (localStorage.getItem('next_action') === 'clear_cache') {
			setDeleting(true);
			localStorage.removeItem('next_action');
			const request = window.indexedDB.deleteDatabase('DMMDB');
			setDeleting(true);
			request.onsuccess = function () {
				window.location.assign('/');
			};
			request.onerror = function () {
				setDeleting(false);
				toast.error('Database deletion failed', genericToastOptions);
			};
			request.onblocked = function () {
				setDeleting(false);
				toast(
					'Database is still open, refresh the page first and then try deleting again',
					genericToastOptions
				);
			};
		}
	}, [rdError, adError, traktError]);

	useEffect(() => {
		if (rdUser) {
			// Calculate days remaining either from premium seconds or expiration date
			const daysRemaining = rdUser.premium
				? Math.floor(rdUser.premium / (24 * 60 * 60)) // Convert seconds to days
				: Math.floor(
						(new Date(rdUser.expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
					);

			if (!rdUser.premium) {
				Swal.fire({
					title: 'Premium Required',
					text: 'This app is only available to Real-Debrid Premium users. Click OK to become premium now.',
					icon: 'warning',
					showCancelButton: true,
					confirmButtonText: 'Become Premium now',
					cancelButtonText: 'Cancel',
				}).then((result) => {
					if (result.isConfirmed) {
						window.open('https://real-debrid.com/premium', '_blank');
					}
					handleLogout('rd:');
				});
			} else if (daysRemaining <= 7) {
				const now = Date.now();
				const lastWarning = parseInt(localStorage.getItem('rd_premium_warning') || '0');
				if (now - lastWarning >= 24 * 60 * 60 * 1000) {
					// 24 hours in milliseconds
					Swal.fire({
						title: 'Premium Expiring Soon',
						text: `Your Real-Debrid premium subscription will expire in ${daysRemaining} days. Click OK to renew now.`,
						icon: 'warning',
						showCancelButton: true,
						confirmButtonText: 'Renew Premium now',
						cancelButtonText: 'Later',
					}).then((result) => {
						if (result.isConfirmed) {
							window.open('https://real-debrid.com/premium', '_blank');
						}
						localStorage.setItem('rd_premium_warning', now.toString());
					});
				}
			}
		}
	}, [rdUser]);

	const handleLogout = (prefix?: string) => {
		if (prefix) {
			let i = localStorage.length - 1;
			while (i >= 0) {
				const key = localStorage.key(i);
				if (key && key.startsWith(prefix)) localStorage.removeItem(key);
				i--;
			}
			router.reload();
		} else {
			localStorage.clear();
			router.push('/start');
		}
	};

	const handleTraktLogin = async () => {
		// generate authorization url
		const authUrl = `/api/trakt/auth?redirect=${window.location.origin}`;
		router.push(authUrl);
	};

	const handleClearCache = async () => {
		localStorage.setItem('next_action', 'clear_cache');
		window.location.assign('/');
	};

	const handleTraktNavigate = (path: string) => {
		if (!traktUser) {
			Swal.fire({
				title: 'Trakt Login Required',
				text: 'Please login with Trakt to access this feature',
				icon: 'info',
				showCancelButton: true,
				confirmButtonText: 'Login now',
				cancelButtonText: 'Cancel',
			}).then((result) => {
				if (result.isConfirmed) {
					handleTraktLogin();
				}
			});
			return;
		}
		router.push(path);
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Home</title>
			</Head>
			<svg
				className="w-24 h-24 mb-4"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 200 200"
			>
				<rect x="25" y="25" width="150" height="150" fill="#2C3E50" rx="20" ry="20" />
				<circle cx="100" cy="100" r="60" fill="#00A0B0" />
				<path d="M85,65 L85,135 L135,100 Z" fill="#ECF0F1" />
				<path d="M60,90 Q80,60 100,90 T140,90" fill="#CC333F" />
				<path
					d="M75,121 L80,151 L90,136 L100,151 L110,136 L120,151 L125,121 Z"
					fill="#EDC951"
				/>
			</svg>
			<Toaster position="bottom-right" />
			{/* this is made by ChatGPT */}
			{!deleting && (rdUser || adUser) ? (
				<>
					<h1 className="text-2xl font-bold mb-6 text-white">
						Debrid Media Manager{' '}
						<a
							href="https://www.patreon.com/debridmediamanager"
							className="text-2xl hover:opacity-75"
						>
							📢
						</a>
					</h1>

					<div className="flex flex-col items-center w-full max-w-md gap-6">
						{/* Service Status Cards */}
						<div className="grid grid-cols-1 gap-3 w-full">
							{rdUser ? (
								<div className="flex items-center justify-center gap-2 p-3 rounded border-2 border-green-500 bg-green-900/30 text-green-100">
									<span className="font-medium">Real-Debrid</span>
									<span>{rdUser.username}</span>
									<span>{rdUser.premium ? '✅' : '❌'}</span>
								</div>
							) : (
								<Link
									href="/realdebrid/login"
									className="w-full text-center py-3 rounded border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 transition-colors"
								>
									Login with Real-Debrid
								</Link>
							)}
							{adUser ? (
								<div className="flex items-center justify-center gap-2 p-3 rounded border-2 border-yellow-500 bg-yellow-900/30 text-yellow-100">
									<span className="font-medium">AllDebrid</span>
									<span>{adUser.username}</span>
									<span>{adUser.isPremium ? '✅' : '❌'}</span>
								</div>
							) : (
								<Link
									href="/alldebrid/login"
									className="w-full text-center py-3 rounded border-2 border-yellow-500 bg-yellow-900/30 text-yellow-100 hover:bg-yellow-800/50 transition-colors"
								>
									Login with AllDebrid
								</Link>
							)}
							{traktUser ? (
								<div className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100">
									<span className="font-medium">Trakt</span>
									<span>{traktUser.user.username}</span>
									<span className="text-green-500">✅</span>
								</div>
							) : (
								<button
									onClick={() => handleTraktLogin()}
									className="w-full text-center py-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors"
								>
									Login with Trakt
								</button>
							)}
						</div>

						{/* Main Actions */}
						<div className="grid grid-cols-2 gap-3 w-full">
							<Link
								href="/library"
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 transition-colors"
							>
								<span>📚</span> Library
							</Link>
							<Link
								href="/search"
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-fuchsia-500 bg-fuchsia-900/30 text-fuchsia-100 hover:bg-fuchsia-800/50 transition-colors"
							>
								<span>🔎</span> Search
							</Link>
							<Link
								href="https://hashlists.debridmediamanager.com"
								target="_blank"
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-indigo-500 bg-indigo-900/30 text-indigo-100 hover:bg-indigo-800/50 transition-colors"
							>
								🚀 Hash lists
							</Link>
							<Link
								href="/animesearch"
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-pink-500 bg-pink-900/30 text-pink-100 hover:bg-pink-800/50 transition-colors"
							>
								<span>🌸</span> Anime
							</Link>
							{rdUser && (
								<Link
									href="/stremio"
									className="flex items-center justify-center gap-2 p-3 rounded border-2 border-purple-500 bg-purple-900/30 text-purple-100 hover:bg-purple-800/50 transition-colors"
								>
									<span>🔮</span> Stremio
								</Link>
							)}
							<Link
								href=""
								onClick={() => showSettings()}
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 transition-colors"
							>
								⚙️ Settings
							</Link>
						</div>

						{/* Browse Section */}
						<div className="flex flex-wrap justify-center gap-2">
							<Link
								href="/browse"
								className="px-4 py-2 rounded border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors text-sm font-medium"
							>
								🏆 top
							</Link>
							<Link
								href="/browse/recent"
								className="px-4 py-2 rounded border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors text-sm font-medium"
							>
								⏰ recent
							</Link>
							{browseTerms.map((term) => (
								<Link
									key={term}
									href={`/browse/${term.replace(/\W/gi, '')}`}
									className="px-4 py-2 rounded border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 transition-colors text-sm font-medium"
								>
									{term}
								</Link>
							))}
						</div>

						{/* Trakt Section */}
						<div className="grid grid-cols-2 gap-3 w-full">
							<button
								onClick={() => handleTraktNavigate('/trakt/movies')}
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium"
							>
								🎥 Movies
							</button>
							<button
								onClick={() => handleTraktNavigate('/trakt/shows')}
								className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium"
							>
								📺 Shows
							</button>
							{traktUser && (
								<>
									<Link
										href="/trakt/watchlist"
										className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium"
									>
										👀 Watchlist
									</Link>
									<Link
										href="/trakt/collection"
										className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium"
									>
										🗃️ Collections
									</Link>
									<Link
										href="/trakt/mylists"
										className="flex items-center justify-center gap-2 p-3 rounded border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 transition-colors text-sm font-medium"
									>
										🧏🏻‍♀️ My lists
									</Link>
								</>
							)}
						</div>

						{/* Info Section */}
						<div className="space-y-3 text-sm text-center">
							{/* Keep existing info content but wrapped in a border */}
							<div className="p-4 rounded border-2 border-gray-600 bg-gray-800/50 text-gray-100">
								<div className="text-sm mb-1 text-center">
									✨ Get DMM browser extensions for{' '}
									<b>
										<a
											className="underline text-blue-300 hover:text-blue-200"
											href="https://chromewebstore.google.com/detail/debrid-media-manager/fahmnboccjgkbeeianfdiohbbgmgoibb"
											target="_blank"
										>
											Chrome
										</a>
									</b>{' '}
									and{' '}
									<b>
										<a
											className="underline text-blue-300 hover:text-blue-200"
											href="https://addons.mozilla.org/en-US/firefox/addon/debrid-media-manager/"
											target="_blank"
										>
											Firefox
										</a>
									</b>{' '}
									or{' '}
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://apps.apple.com/us/app/userscripts/id1463298887"
										target="_blank"
									>
										Safari
									</a>{' '}
									with the{' '}
									<b>
										<a
											className="underline text-blue-300 hover:text-blue-200"
											href="https://greasyfork.org/en/scripts/463268-debrid-media-manager"
											target="_blank"
										>
											userscript
										</a>
									</b>
								</div>

								<div className="text-sm mb-1 text-center">
									✨
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://github.com/debridmediamanager/zurg-testing"
										target="_blank"
									>
										<b>zurg</b>
									</a>{' '}
									mounts your Real-Debrid library and play your files directly
									from your computer or with Plex
								</div>
								<div className="text-sm mb-1 text-center">
									✨
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href=" https://apps.apple.com/app/apple-store/id1659622164?pt=122790787&mt=8&ct=debridmediamanager"
										target="_blank"
									>
										<b>VidHub</b>
									</a>{' '}
									is a new media player that works with debrid services. Android
									is coming soon!
								</div>
								<div className="text-sm mb-1 text-center">
									✨
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://elfhosted.com/guides/media/"
										target="_blank"
									>
										<b>ElfHosted</b>
									</a>{' '}
									offers hosted, turn-key streaming stacks including zurg, Plex &
									Riven, with 7-day free trials
								</div>
								<div className="text-sm mb-1 text-center">
									✨
									<a
										className="text-azure bg-red-500 text-red-100 px-1"
										href="https://www.reddit.com/r/debridmediamanager/"
										target="_blank"
									>
										r/debridmediamanager
									</a>{' '}
									🤝 Sponsor this project&apos;s development on{' '}
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://github.com/sponsors/debridmediamanager"
										target="_blank"
									>
										Github
									</a>{' '}
									|{' '}
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://www.patreon.com/debridmediamanager"
										target="_blank"
									>
										Patreon
									</a>{' '}
									|{' '}
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://paypal.me/yowmamasita"
										target="_blank"
									>
										Paypal
									</a>
								</div>
								{/* add discord link */}
								<div className="text-sm mb-1 text-center">
									✨ Lastly... we now have a{' '}
									<a
										className="underline text-blue-300 hover:text-blue-200"
										href="https://discord.gg/7u4YjMThXP"
										target="_blank"
									>
										<b>Discord</b>
									</a>{' '}
									community
								</div>
							</div>
						</div>

						{/* Action Buttons */}
						<div className="flex flex-wrap justify-center gap-2">
							<button
								onClick={() => handleClearCache()}
								className="px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium"
							>
								Clear library cache
							</button>
							{(rdUser || rdError) && (
								<button
									onClick={() => handleLogout('rd:')}
									className="px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium"
								>
									Logout Real-Debrid
								</button>
							)}
							{(adUser || adError) && (
								<button
									onClick={() => handleLogout('ad:')}
									className="px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium"
								>
									Logout AllDebrid
								</button>
							)}
							{(traktUser || traktError) && (
								<button
									onClick={() => handleLogout('trakt:')}
									className="px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium"
								>
									Logout Trakt
								</button>
							)}
							{(rdUser || adUser || traktUser) && (
								<button
									onClick={() => handleLogout()}
									className="px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium"
								>
									Logout All
								</button>
							)}
						</div>
					</div>
				</>
			) : (
				<>
					<h1 className="text-xl text-center pb-4 text-white">
						Debrid Media Manager is loading...
					</h1>
					{deleting && (
						<h3 className="text-md text-center pb-4 text-white">
							If it gets stuck here, close all DMM tabs first
						</h3>
					)}
					<button
						onClick={() => handleLogout()}
						className="px-4 py-2 rounded border border-black hover:bg-black hover:text-white transition-colors text-sm"
					>
						Logout All
					</button>
				</>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
