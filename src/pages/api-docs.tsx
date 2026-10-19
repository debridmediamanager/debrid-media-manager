import Head from 'next/head';
import Link from 'next/link';
import Script from 'next/script';

// Scalar's standalone bundle renders the OpenAPI document; the same document is
// served raw at /api/openapi.json for code generators and API clients.
const SCALAR =
	'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4/dist/browser/standalone.js';

declare global {
	interface Window {
		Scalar?: { createApiReference: (selector: string, config: object) => unknown };
	}
}

export default function ApiDocsPage() {
	return (
		<div className="min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - API</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<noscript>
				<p className="p-4 text-gray-200">
					The API reference needs JavaScript. The OpenAPI document is at{' '}
					<Link href="/api/openapi.json" className="underline">
						/api/openapi.json
					</Link>
					.
				</p>
			</noscript>
			<div id="api-reference" />
			<Script
				src={SCALAR}
				strategy="afterInteractive"
				onLoad={() =>
					window.Scalar?.createApiReference('#api-reference', {
						url: '/api/openapi.json',
						forceDarkModeState: 'dark',
						hideDarkModeToggle: true,
					})
				}
			/>
		</div>
	);
}
