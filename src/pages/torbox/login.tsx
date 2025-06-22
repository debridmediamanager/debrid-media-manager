import useLocalStorage from '@/hooks/localStorage';
import { getUserData } from '@/services/torbox';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

export default function TorboxLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('tb:apiKey');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		try {
			// Verify the API key works by attempting to get user info
			const userData = await getUserData(inputApiKey);

			// If successful, save the API key
			setApiKey(inputApiKey);
			await router.push('/');
		} catch (err: any) {
			console.error(
				'Failed to validate API key:',
				err instanceof Error ? err.message : 'Unknown error'
			);
			setError(
				`API Error: ${err.response?.data?.message || err.message || 'Could not validate API key'}. Status: ${err.response?.status || 'unknown'}`
			);
		}
	};

	const handleGetApiKey = () => {
		window.open('https://torbox.app/settings', '_blank');
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Torbox Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Torbox</h1>
				{error && <p className="text-center text-red-500">{error}</p>}
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="apiKey" className="block text-sm font-medium">
							API Key
						</label>
						<input
							type="text"
							id="apiKey"
							value={inputApiKey}
							onChange={(e) => setInputApiKey(e.target.value)}
							className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							placeholder="Enter your Torbox API key"
							required
						/>
					</div>
					<div className="flex flex-col space-y-2">
						<button
							type="submit"
							className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
						>
							Save API Key
						</button>
						<button
							type="button"
							onClick={handleGetApiKey}
							className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
						>
							Get API Key from Torbox
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
