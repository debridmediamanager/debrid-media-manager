import getConfig from 'next/config';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const { publicRuntimeConfig } = getConfig();

interface PatreonUser {
	username: string;
	tier: string;
	tierAmount: number;
	canAccessGithub: boolean;
}

interface GitHubUser {
	username: string;
}

interface DiscordUser {
	username: string;
}

export default function Connect() {
	const [isPatreonConnected, setIsPatreonConnected] = useState(false);
	const [isPatreonSubscriber, setIsPatreonSubscriber] = useState(false);
	const [patreonUser, setPatreonUser] = useState<PatreonUser | null>(null);
	const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
	const [discordUser, setDiscordUser] = useState<DiscordUser | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const router = useRouter();
	const { error } = router.query;

	useEffect(() => {
		// Check if user has valid tokens and is a subscriber
		const patreonToken = localStorage.getItem('patreonToken');
		const userId = localStorage.getItem('userId');
		const githubUsername = localStorage.getItem('githubUsername');
		const discordUsername = localStorage.getItem('discordUsername');

		if (githubUsername) {
			setGithubUser({ username: githubUsername });
		}

		if (discordUsername) {
			setDiscordUser({ username: discordUsername });
		}

		if (patreonToken && userId) {
			setIsPatreonConnected(true);
			// First, fetch user details from our database
			fetch(`/api/user/${userId}`)
				.then((res) => res.json())
				.then((userData) => {
					if (userData.patreonSubscription) {
						const tierAmount = parseInt(
							userData.patreonSubscription.perks.match(/\$(\d+)/)?.[1] || '0'
						);
						setPatreonUser({
							username: userData.username || 'Patron',
							tier: userData.patreonSubscription.tier,
							tierAmount: tierAmount * 100, // Convert to cents
							canAccessGithub: tierAmount >= 4,
						});
						setIsPatreonSubscriber(true);
					}
				})
				.catch(() => {
					localStorage.removeItem('patreonToken');
					localStorage.removeItem('patreonRefresh');
					localStorage.removeItem('userId');
					setPatreonUser(null);
					setIsPatreonConnected(false);
					setIsPatreonSubscriber(false);
				})
				.finally(() => {
					setIsLoading(false);
				});
		} else {
			setIsLoading(false);
		}
	}, []);

	const handlePatreonLogin = () => {
		const scope = 'identity identity.memberships campaigns';
		const redirectUri = `${window.location.origin}/patreoncallback`;
		const authUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${publicRuntimeConfig.patreonClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
		window.location.href = authUrl;
	};

	const handleGithubLogin = () => {
		const redirectUri = `${window.location.origin}/githubcallback`;
		const authUrl = `https://github.com/login/oauth/authorize?client_id=${publicRuntimeConfig.githubClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
		window.location.href = authUrl;
	};

	const handleDiscordLogin = () => {
		const redirectUri = `${window.location.origin}/discordcallback`;
		const authUrl = `https://discord.com/oauth2/authorize?client_id=${publicRuntimeConfig.discordClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
		window.location.href = authUrl;
	};

	const handleGithubLogout = () => {
		localStorage.removeItem('githubToken');
		localStorage.removeItem('githubUsername');
		setGithubUser(null);
	};

	const handleDiscordLogout = () => {
		localStorage.removeItem('discordToken');
		localStorage.removeItem('discordUsername');
		setDiscordUser(null);
	};

	const handlePatreonLogout = () => {
		localStorage.removeItem('patreonToken');
		localStorage.removeItem('patreonRefresh');
		localStorage.removeItem('userId');
		localStorage.removeItem('githubToken');
		localStorage.removeItem('githubUsername');
		localStorage.removeItem('discordToken');
		localStorage.removeItem('discordUsername');
		setPatreonUser(null);
		setGithubUser(null);
		setDiscordUser(null);
		setIsPatreonConnected(false);
		setIsPatreonSubscriber(false);
	};

	const getErrorMessage = (errorType?: string) => {
		switch (errorType) {
			case 'github_auth_failed':
				return 'GitHub authentication failed.';
			case 'discord_auth_failed':
				return 'Discord authentication failed.';
			default:
				return 'Authentication failed.';
		}
	};

	return (
		<div className="min-h-screen bg-gray-900 text-white">
			<Head>
				<title>DMM zurg Connect</title>
			</Head>

			<div className="mx-auto max-w-2xl px-4 pt-20">
				<h1 className="mb-8 text-center text-3xl font-bold">DMM zurg Connect</h1>

				{error && (
					<div className="mb-6 rounded-lg bg-red-500 p-4 text-center text-white">
						{getErrorMessage(error as string)} Please try again.
					</div>
				)}

				{isLoading ? (
					<div className="text-center">
						<div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
						<p className="mt-4 text-gray-400">Loading...</p>
					</div>
				) : (
					<div className="space-y-6">
						{!isPatreonConnected ? (
							<>
								<button
									onClick={handlePatreonLogin}
									className="w-full rounded-lg bg-[#FF424D] px-4 py-3 font-medium text-white transition-colors hover:bg-opacity-90"
								>
									Connect with Patreon
								</button>
								<p className="text-center text-sm text-gray-400">
									Please connect your Patreon account to continue
								</p>
							</>
						) : (
							<>
								<div className="space-y-4 rounded-lg bg-gray-800 p-6">
									<div className="flex items-start justify-between">
										<div>
											<div className="text-lg font-medium">
												{patreonUser?.username}
											</div>
											<div className="mt-1 text-sm text-gray-400">
												Tier: {patreonUser?.tier}
												{isPatreonSubscriber && (
													<span className="ml-2">
														(${(patreonUser?.tierAmount || 0) / 100}
														/month)
													</span>
												)}
											</div>
										</div>
										<div
											className={`rounded-full px-3 py-1 text-sm ${isPatreonSubscriber ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
										>
											{isPatreonSubscriber
												? 'Active Subscriber'
												: 'Not Subscribed'}
										</div>
									</div>
									<button
										onClick={handlePatreonLogout}
										className="text-sm text-red-400 hover:text-red-300"
									>
										Disconnect Patreon
									</button>
								</div>

								{isPatreonSubscriber && (
									<div className="space-y-4">
										{patreonUser?.canAccessGithub ? (
											githubUser ? (
												<div className="flex items-center justify-between rounded-lg bg-gray-800 p-4">
													<div>
														<span className="text-sm text-gray-400">
															GitHub:
														</span>
														<span className="ml-2">
															{githubUser.username}
														</span>
													</div>
													<button
														onClick={handleGithubLogout}
														className="text-sm text-red-400 hover:text-red-300"
													>
														Disconnect
													</button>
												</div>
											) : (
												<button
													onClick={handleGithubLogin}
													className="w-full rounded-lg bg-gray-800 px-4 py-3 font-medium text-white transition-colors hover:bg-opacity-90"
												>
													Connect with GitHub
												</button>
											)
										) : (
											<div className="text-center text-sm text-gray-400">
												<p>
													Upgrade to $4/month tier to access GitHub
													features
												</p>
												<a
													href="https://www.patreon.com/debridmediamanager"
													target="_blank"
													rel="noopener noreferrer"
													className="mt-2 inline-block text-[#FF424D] hover:text-[#FF424D]/80"
												>
													Upgrade Tier
												</a>
											</div>
										)}

										{discordUser ? (
											<div className="flex items-center justify-between rounded-lg bg-gray-800 p-4">
												<div>
													<span className="text-sm text-gray-400">
														Discord:
													</span>
													<span className="ml-2">
														{discordUser.username}
													</span>
												</div>
												<button
													onClick={handleDiscordLogout}
													className="text-sm text-red-400 hover:text-red-300"
												>
													Disconnect
												</button>
											</div>
										) : (
											<button
												onClick={handleDiscordLogin}
												className="w-full rounded-lg bg-[#5865F2] px-4 py-3 font-medium text-white transition-colors hover:bg-opacity-90"
											>
												Connect with Discord
											</button>
										)}
									</div>
								)}

								{!isPatreonSubscriber && (
									<div className="text-center text-sm text-gray-400">
										<p>
											You need to be a DMM Patron to access additional
											features.
										</p>
										<a
											href="https://www.patreon.com/debridmediamanager"
											target="_blank"
											rel="noopener noreferrer"
											className="mt-2 inline-block text-[#FF424D] hover:text-[#FF424D]/80"
										>
											Become a Patron
										</a>
									</div>
								)}
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
