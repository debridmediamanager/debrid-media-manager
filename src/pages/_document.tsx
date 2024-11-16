import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
	return (
		<Html lang="en">
			<Head>
				<meta charSet="UTF-8" />
				<meta
					name="description"
					content="Debrid Media Manager - Curate an infinite media library"
				/>
				<meta
					name="keywords"
					content="media manager, digital media, streaming, movies, tv shows, anime"
				/>
				<meta property="og:title" content="Debrid Media Manager" />
				<meta property="og:description" content="Curate an infinite media library" />
				<meta
					property="og:image"
					content="https://debridmediamanager.com/apple-touch-icon.png"
				/>
				<meta property="og:url" content="https://debridmediamanager.com" />
				<meta property="og:type" content="website" />
				<meta name="author" content="yowmamasita" />
				<meta name="robots" content="nofollow" />
				<meta name="apple-mobile-web-app-title" content="DMM" />
				<meta name="theme-color" content="#1f1f1f" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="application-name" content="DMM" />
				<meta name="format-detection" content="telephone=no" />
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
				<link rel="manifest" href="/site.webmanifest" />
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
