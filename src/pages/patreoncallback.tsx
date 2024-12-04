import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function PatreonCallback() {
	const router = useRouter();
	const { code } = router.query;

	useEffect(() => {
		const handleCallback = async () => {
			if (!code) return;

			try {
				// Exchange the code for access token
				const response = await fetch('/api/auth/patreon', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ code }),
				});

				if (!response.ok) {
					throw new Error('Failed to authenticate with Patreon');
				}

				const data = await response.json();

				// Store the tokens and user ID
				localStorage.setItem('patreonToken', data.access_token);
				localStorage.setItem('patreonRefresh', data.refresh_token);
				localStorage.setItem('userId', data.userId.toString());

				router.push('/connect');
			} catch (error) {
				console.error('Authentication error:', error);
				router.push('/connect?error=auth_failed');
			}
		};

		handleCallback();
	}, [code, router]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
			<div className="text-center">
				<h1 className="mb-4 text-2xl font-bold">Authenticating with Patreon...</h1>
				<div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
			</div>
		</div>
	);
}
