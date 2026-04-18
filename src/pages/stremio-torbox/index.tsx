import { CastSettingsPanel } from '@/components/CastSettingsPanel';
import { useTorBoxCastToken } from '@/hooks/torboxCastToken';
import { withAuth } from '@/utils/withAuth';
import { AlertTriangle, Cast, ClipboardList, EyeOff, Globe, Popcorn, Wand2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

export function StremioTorBoxPage() {
	const dmmCastToken = useTorBoxCastToken();
	const [hasTorBoxCredentials] = useState(() => {
		if (typeof window !== 'undefined') {
			const apiKey = localStorage.getItem('tb:apiKey');
			return !!apiKey;
		}
		return false;
	});

	if (!hasTorBoxCredentials) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
				<Head>
					<title>DMM Cast for TorBox - Stremio</title>
				</Head>
				<div className="max-w-md rounded-lg border-2 border-red-500 bg-red-900/20 p-6 text-center">
					<AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" />
					<h1 className="mb-3 text-2xl font-bold text-red-400">TorBox Required</h1>
					<p className="mb-4 text-gray-300">
						You must be logged in with TorBox to use the Stremio Cast feature.
					</p>
					<Link
						href="/torbox/login"
						className="haptic-sm inline-block rounded border-2 border-purple-500 bg-purple-800/30 px-6 py-2 font-medium text-purple-100 transition-colors hover:bg-purple-700/50"
					>
						Login with TorBox
					</Link>
				</div>
			</div>
		);
	}

	if (!dmmCastToken) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
				<h1 className="text-center text-xl text-white">
					Debrid Media Manager is loading...
				</h1>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-4">
			<Head>
				<title>DMM Cast for TorBox - Stremio</title>
			</Head>

			<Image
				width={200}
				height={200}
				src="https://static.debridmediamanager.com/dmmcast.png"
				alt="logo"
				className="mb-4"
			/>
			<h1 className="mb-4 text-2xl font-bold text-purple-400">DMM Cast for TorBox</h1>
			<div className="flex flex-col items-center text-white">
				<strong>Cast from any device to Stremio</strong>

				{dmmCastToken && (
					<div className="mb-4 mt-4 h-max text-center leading-8">
						<Link
							href={`stremio://${window.location.origin.replace(
								/^https?:\/\//,
								''
							)}/api/stremio-tb/${dmmCastToken}/manifest.json`}
							className="text-md haptic-sm m-1 rounded border-2 border-purple-500 bg-purple-800/30 px-4 py-2 font-medium text-gray-100 transition-colors hover:bg-purple-700/50"
						>
							<Wand2 className="mr-1 inline-block h-4 w-4 text-purple-400" />
							Install
						</Link>
						<Link
							href={`https://web.stremio.com/#/addons?addon=${encodeURIComponent(
								`${window.location.origin}/api/stremio-tb/${dmmCastToken}/manifest.json`
							)}`}
							className="text-md haptic-sm m-1 rounded border-2 border-purple-500 bg-purple-800/30 px-4 py-2 font-medium text-gray-100 transition-colors hover:bg-purple-700/50"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Globe className="mr-1 inline-block h-4 w-4 text-blue-400" />
							Install (web)
						</Link>
						<div className="mt-2 text-gray-300">
							or copy this link and paste it in Stremio&apos;s search bar
						</div>
						<div className="mt-2 text-sm text-red-400">
							<AlertTriangle className="mr-1 inline-block h-4 w-4 text-red-400" />
							Warning: Never share this install URL with anyone. It is unique to your
							account and sharing it could compromise your access.
						</div>
						<code className="mt-2 block w-full break-all rounded bg-gray-800 p-2 text-sm text-gray-300">
							{window.location.origin}/api/stremio-tb/{dmmCastToken}/manifest.json
						</code>

						{/* No Catalog Version */}
						<div className="mt-4 border-t border-gray-700 pt-4">
							<div className="mb-2 flex items-center justify-center text-sm text-gray-400">
								<EyeOff className="mr-1 h-3 w-3" />
								No Catalog Version (hides all catalogs from Stremio home)
							</div>
							<Link
								href={`stremio://${window.location.origin.replace(
									/^https?:\/\//,
									''
								)}/api/stremio-tb/${dmmCastToken}/no-catalog/manifest.json`}
								className="haptic-sm m-1 rounded border border-gray-600 bg-gray-800/50 px-3 py-1 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700/50"
							>
								<Wand2 className="mr-1 inline-block h-3 w-3 text-gray-400" />
								Install
							</Link>
							<Link
								href={`https://web.stremio.com/#/addons?addon=${encodeURIComponent(
									`${window.location.origin}/api/stremio-tb/${dmmCastToken}/no-catalog/manifest.json`
								)}`}
								className="haptic-sm m-1 rounded border border-gray-600 bg-gray-800/50 px-3 py-1 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700/50"
								target="_blank"
								rel="noopener noreferrer"
							>
								<Globe className="mr-1 inline-block h-3 w-3 text-gray-400" />
								Install (web)
							</Link>
						</div>
					</div>
				)}

				<div className="space-y-2 text-gray-300">
					<div>1. Choose a Movie or TV Show in DMM</div>
					<div>
						2. Click the &quot;
						<Cast className="inline-block h-3 w-3 text-purple-400" /> Cast&quot; button
					</div>
					<div>3. Stremio opens automatically to the movie/show</div>
					<div>4. Your casted stream appears in the stream list</div>
					<div>
						5.{' '}
						<span className="inline-flex items-center">
							Enjoy! <Popcorn className="ml-1 inline-block h-4 w-4 text-yellow-500" />
						</span>
					</div>
				</div>

				<CastSettingsPanel service="tb" accentColor="purple" />
			</div>

			<div className="mt-6 flex gap-4">
				{dmmCastToken && (
					<Link
						href="/stremio-torbox/manage"
						className="haptic-sm rounded border-2 border-purple-500 bg-purple-800/30 px-4 py-2 text-sm font-medium text-purple-100 transition-colors hover:bg-purple-700/50"
					>
						<span className="inline-flex items-center">
							<ClipboardList className="mr-1 h-4 w-4" />
							Manage Casted Links
						</span>
					</Link>
				)}
				<Link
					href="/"
					className="haptic-sm rounded border-2 border-cyan-500 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
		</div>
	);
}

export default dynamic(() => Promise.resolve(withAuth(StremioTorBoxPage)), { ssr: false });
