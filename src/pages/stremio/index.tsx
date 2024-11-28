import { useCastToken } from '@/hooks/castToken';
import { withAuth } from '@/utils/withAuth';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';

function StremioPage() {
	const dmmCastToken = useCastToken();

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
				<title>Debrid Media Manager - Stremio</title>
			</Head>

			<Image
				width={200}
				height={200}
				src="https://static.debridmediamanager.com/dmmcast.png"
				alt="logo"
				className="mb-4"
			/>
			<h1 className="mb-4 text-2xl font-bold text-purple-400">DMM Cast</h1>
			<div className="flex flex-col items-center text-white">
				<strong>Cast from any device to Stremio</strong>

				{dmmCastToken !== 'default' && (
					<div className="mb-4 mt-4 h-max text-center leading-8">
						<Link
							href={`stremio://${window.location.origin.replace(
								/^https?:\/\//,
								''
							)}/api/stremio/${dmmCastToken}/manifest.json`}
							className="text-md haptic-sm m-1 rounded border-2 border-purple-500 bg-purple-800/30 px-4 py-2 font-medium text-gray-100 transition-colors hover:bg-purple-700/50"
						>
							🧙🏻‍♂️ Install
						</Link>
						<Link
							href={`https://web.stremio.com/#/addons?addon=${encodeURIComponent(
								`${window.location.origin}/api/stremio/${dmmCastToken}/manifest.json`
							)}`}
							className="text-md haptic-sm m-1 rounded border-2 border-purple-500 bg-purple-800/30 px-4 py-2 font-medium text-gray-100 transition-colors hover:bg-purple-700/50"
							target="_blank"
							rel="noopener noreferrer"
						>
							🌐 Install (web)
						</Link>
						<div className="mt-2 text-gray-300">
							or copy this link and paste it in Stremio&apos;s search bar
						</div>
						<div className="mt-2 text-sm text-red-400">
							⚠️ Warning: Never share this install URL with anyone. It is unique to
							your account and sharing it could compromise your access.
						</div>
						<code className="mt-2 block w-full break-all rounded bg-gray-800 p-2 text-sm text-gray-300">
							{window.location.origin}/api/stremio/{dmmCastToken}/manifest.json
						</code>
					</div>
				)}

				<div className="space-y-2 text-gray-300">
					<div>1. Choose a Movie or TV Show to watch in DMM</div>
					<div>
						2. Select a Torrent &gt; click &quot;👀 Look Inside&quot; &gt; click
						&quot;Cast✨&quot; button
					</div>
					<div>📝 it will also open Stremio if you want to watch on the same device</div>
					<div>3. Open the *same* Movie or TV Show in Stremio</div>
					<div>4. Choose &quot;Stream🪄&quot;</div>
					<div>5. Enjoy!🍿</div>
				</div>
			</div>

			<div className="mt-6 flex gap-4">
				{dmmCastToken !== 'default' && (
					<Link
						href="/stremio/manage"
						className="haptic-sm rounded border-2 border-purple-500 bg-purple-800/30 px-4 py-2 text-sm font-medium text-purple-100 transition-colors hover:bg-purple-700/50"
					>
						📝 Manage Casted Links
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

export default dynamic(() => Promise.resolve(withAuth(StremioPage)), { ssr: false });
