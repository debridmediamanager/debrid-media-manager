import useLocalStorage from '@/hooks/localStorage';
import { getTorrinUser } from '@/services/torrin';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

export default function TorrinLoginPage() {
	const router = useRouter();
	const [, setBaseUrl] = useLocalStorage<string>('torrin:baseUrl');
	const [, setApiKey] = useLocalStorage<string>('torrin:apiKey');
	const [inputBaseUrl, setInputBaseUrl] = useState('https://torrin.app');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		const baseUrl = inputBaseUrl.trim().replace(/\/+$/, '');
		try {
			await getTorrinUser(baseUrl, inputApiKey.trim());
			setBaseUrl(baseUrl);
			setApiKey(inputApiKey.trim());
			const redirectPath = getSafeRedirectPath(router.query.redirect, '/');
			await router.replace(redirectPath);
		} catch (err: any) {
			setError(
				`API Error: ${err.response?.data?.error || err.message || 'Could not validate credentials'}. Status: ${err.response?.status || 'unknown'}`
			);
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Torrin Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Torrin</h1>
				<p className="text-center text-sm text-gray-400">
					Torrin is a self-hostable, open-source debrid service. Enter your instance URL
					and API key.
				</p>
				{error && <p className="text-center text-red-500">{error}</p>}
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="baseUrl" className="block text-sm font-medium">
							Instance URL
						</label>
						<input
							type="url"
							id="baseUrl"
							value={inputBaseUrl}
							onChange={(e) => setInputBaseUrl(e.target.value)}
							className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							placeholder="https://your-torrin.example.com"
							required
						/>
					</div>
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
							placeholder="Enter your Torrin API key"
							required
						/>
					</div>
					<button
						type="submit"
						className="w-full rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
					>
						Save &amp; Connect
					</button>
				</form>
			</div>
		</div>
	);
}
