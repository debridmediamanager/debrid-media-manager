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
				<div className="mt-2 mb-2 h-max text-center leading-10">
					<Link
						href={`stremio://${window.location.origin.replace(
							/^https?:\/\//,
							''
						)}/api/dmmcast/magic/${dmmCastToken}/manifest.json`}
						className="text-md m-1 bg-cyan-800 hover:bg-cyan-700 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
					>
						🧙🏻‍♂️ Install
					</Link>
					or copy this link and paste it in Stremio&apos;s search bar
					<br />
					<code className="text-sm text-black bg-gray-100 p-1 rounded">
						{window.location.origin}/api/dmmcast/magic/{dmmCastToken}/manifest.json
					</code>
				</div>
				1. Choose a Movie to watch in DMM
				<br />
				2. Choose a Torrent &gt; Watch &gt; Cast✨
				<br />
				3. Open the same Movie in Stremio
				<br />
				4. Choose Stream🪄
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
