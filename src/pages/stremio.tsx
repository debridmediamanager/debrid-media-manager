import { useCastToken } from '@/hooks/cast';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';

function StremioPage() {
	const dmmCastToken = useCastToken();

	if (!dmmCastToken) {
		return (
			<div className="flex flex-col items-center justify-center min-h-screen bg-gray-900">
				<h1 className="text-xl text-center text-white">
					Debrid Media Manager is loading...
				</h1>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900">
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
			<h1 className="text-2xl text-purple-400 font-bold mb-4">DMM Cast</h1>
			<div className="flex flex-col items-center text-white">
				<strong>Cast from any device to Stremio</strong>
				<div className="mt-4 mb-4 h-max text-center leading-8">
					<Link
						href={`stremio://${window.location.origin.replace(
							/^https?:\/\//,
							''
						)}/api/stremio/${dmmCastToken}/manifest.json`}
						className="text-md m-1 px-4 py-2 rounded border-2 border-purple-500 bg-purple-800/30 text-gray-100 hover:bg-purple-700/50 transition-colors font-medium haptic-sm"
					>
						🧙🏻‍♂️ Install
					</Link>
					<div className="mt-2 text-gray-300">
						or copy this link and paste it in Stremio&apos;s search bar
					</div>
					<code className="text-sm bg-gray-800 p-2 rounded mt-2 text-gray-300">
						{window.location.origin}/api/stremio/{dmmCastToken}/manifest.json
					</code>
				</div>
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

			<Link
				href="/"
				className="mt-6 px-4 py-2 rounded border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100
						hover:bg-cyan-800/50 transition-colors text-sm font-medium haptic-sm"
			>
				Go Home
			</Link>
		</div>
	);
}

export default dynamic(() => Promise.resolve(StremioPage), {
	ssr: false,
});
