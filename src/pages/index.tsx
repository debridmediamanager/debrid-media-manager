import { useCurrentUser } from '@/hooks/auth';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

function IndexPage() {
	const router = useRouter();
	const { realDebrid: rdUser, allDebrid: adUser } = useCurrentUser();

	const handleHashListClick = () => {
		const newTab = window.open('https://hashlists.debridmediamanager.com', '_blank');
		newTab?.focus();
	};

	const handleLogout = (prefix?: string) => {
		if (typeof window === 'undefined') {
			// Running on the server, return null
			return null;
		}
		if (prefix) {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key && key.startsWith(prefix)) {
					localStorage.removeItem(key);
				}
			}
			router.reload();
		} else {
			localStorage.clear();
			router.push('/start');
		}
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<Head>
				<title>Debrid Media Manager - Home</title>
			</Head>
			<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
				<rect x="25" y="25" width="150" height="150" fill="#2C3E50" rx="20" ry="20" />
				<circle cx="100" cy="100" r="60" fill="#00A0B0" />
				<path d="M85,65 L85,135 L135,100 Z" fill="#ECF0F1" />
				<path d="M60,90 Q80,60 100,90 T140,90" fill="#CC333F" />
				<path
					d="M75,121 L80,151 L90,136 L100,151 L110,136 L120,151 L125,121 Z"
					fill="#EDC951"
				/>
			</svg>
			{/* this is made by ChatGPT */}
			{rdUser || adUser ? (
				<>
					<h1 className="text-2xl font-bold mb-4">Debrid Media Manager</h1>
					<div className="flex flex-col items-center">
						<p className="text-lg font-bold mb-4">
							Welcome back,{' '}
							{rdUser ? (
								<>
									Real-Debrid: {rdUser.username} {rdUser.premium ? '✅' : '❌'}
								</>
							) : (
								<Link
									href="/realdebrid/login"
									className="px-4 py-2 m-2 text-sm text-white bg-gray-500 rounded hover:bg-gray-600"
								>
									Login with Real-Debrid
								</Link>
							)}{' '}
							{adUser ? (
								<>
									AllDebrid: {adUser.username} {adUser.isPremium ? '✅' : '❌'}
								</>
							) : (
								<Link
									href="/alldebrid/login"
									className="px-4 py-2 m-2 text-white bg-gray-500 rounded hover:bg-gray-600"
								>
									Login with AllDebrid
								</Link>
							)}
						</p>
						<p className="text-sm mb-4">
							8.5+ million torrents collected from all corners of the web
						</p>
						<hr className="w-full" />

						<div className="flex mt-4">
							<Link
								href="/library"
								className="mr-2 bg-cyan-800 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded"
							>
								My Library
							</Link>

							<button
								className="mr-2 bg-cyan-800 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded"
								onClick={handleHashListClick}
							>
								Hash list browser
							</button>

							<Link
								href="/search"
								className="mr-2 bg-blue-800 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
							>
								Search
							</Link>

							<Link
								href="/recentlyupdated"
								className="mr-2 bg-blue-800 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
							>
								Recently Updated
							</Link>

							<Link
								href="/browse"
								className="mr-2 bg-blue-800 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
							>
								Browse
							</Link>
						</div>

						<div className="flex mt-4">
							{/* <button
								className="mr-2 bg-orange-500 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded text-sm"
								onClick={() => router.push('/fixer')}
							>
								Fix playback or scan problems
							</button> */}
							<button
								className="mr-2 bg-orange-500 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded text-sm"
								onClick={() => router.push('/troubleshooting')}
							>
								Troubleshoot
							</button>
							{rdUser && (
								<button
									className="mr-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded text-sm"
									onClick={() => handleLogout('rd:')}
								>
									Logout Real-Debrid
								</button>
							)}
							{adUser && (
								<button
									className="mr-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded text-sm"
									onClick={() => handleLogout('ad:')}
								>
									Logout AllDebrid
								</button>
							)}
						</div>
					</div>
				</>
			) : (
				<h1 className="text-2xl font-bold">Debrid Media Manager is loading...</h1>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
