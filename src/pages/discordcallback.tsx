import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function DiscordCallback() {
	const router = useRouter();
	const { code } = router.query;

	useEffect(() => {
		const handleCallback = async () => {
			if (!code) return;

			try {
				const userId = localStorage.getItem('userId');
				if (!userId) {
					throw new Error('User ID not found');
				}

				// Exchange the code for access token
				const response = await fetch('/api/auth/discord', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ code, userId }),
				});

				if (!response.ok) {
					throw new Error('Failed to authenticate with Discord');
				}

				const data = await response.json();

				// Store the Discord token and username
				localStorage.setItem('discordToken', data.access_token);
				localStorage.setItem('discordUsername', `${data.username}#${data.discriminator}`);

				router.push('/connect');
			} catch (error) {
				console.error('Authentication error:', error);
				router.push('/connect?error=discord_auth_failed');
			}
		};

		handleCallback();
	}, [code, router]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
			<div className="text-center">
				<h1 className="mb-4 text-2xl font-bold">Authenticating with Discord...</h1>
				<div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
			</div>
		</div>
	);
}
