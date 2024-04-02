import { useCastToken } from '@/hooks/cast';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';

function StremioPage() {
	const dmmCastToken = useCastToken();

	if (!dmmCastToken) {
		return (
			<div className="flex flex-col items-center justify-center min-h-screen">
				<h1 className="text-xl text-center">Debrid Media Manager is loading...</h1>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<Head>
				<title>Debrid Media Manager - Stremio</title>
			</Head>

			<Image
				width={200}
				height={200}
				src="https://static.debridmediamanager.com/dmmcast.png"
				alt="logo"
			/>
			<h1 className="text-2xl text-purple-600 font-bold mb-4">DMM Cast</h1>
			<div className="flex flex-col items-center">
				<strong>Cast from any device to Stremio</strong>
				<div>We never ask for or store your API tokens 🔒</div>
				<div className="mt-2 mb-2 h-max text-center leading-10">
					<Link
						href={`stremio://${window.location.origin.replace(
							/^https?:\/\//,
							''
						)}/api/stremio/${dmmCastToken}/manifest.json`}
						className="text-md m-1 bg-purple-800 hover:bg-purple-700 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
					>
						🧙🏻‍♂️ Install
					</Link>
					or copy this link and paste it in Stremio&apos;s search bar
					<br />
					<code className="text-sm text-black bg-gray-100 p-1 rounded">
						{window.location.origin}/api/stremio/{dmmCastToken}/manifest.json
					</code>
				</div>
				1. Choose a Movie or TV Show to watch in DMM
				<br />
				2. Select a Torrent &gt; click &quot;👀 Look Inside&quot; &gt; click
				&quot;Cast✨&quot; button
				<br />
				📝 it will also open Stremio if you want to watch on the same device
				<br />
				3. Open the *same* Movie or TV Show in Stremio
				<br />
				4. Choose &quot;Stream🪄&quot;
				<br />
				5. Enjoy!🍿
			</div>

			<Link
				href="/"
				className="mt-4 text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded whitespace-nowrap"
			>
				Go Home
			</Link>
		</div>
	);
}

export default dynamic(() => Promise.resolve(StremioPage), {
	ssr: false,
});
