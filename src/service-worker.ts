/// <reference lib="webworker" />

import {
	CacheFirst,
	ExpirationPlugin,
	NetworkFirst,
	Serwist,
	type PrecacheEntry,
	type SerwistGlobalConfig,
} from 'serwist';

declare global {
	interface WorkerGlobalScope extends SerwistGlobalConfig {
		__SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
	}
}

declare const self: ServiceWorkerGlobalScope;

const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');
const isAppDocumentUrl = (url: URL) =>
	url.origin === self.location.origin && !isApiPath(url.pathname);

const pages = new NetworkFirst({
	cacheName: 'pages',
	plugins: [
		// Every movie, season and search URL is its own entry.
		new ExpirationPlugin({ maxEntries: 100 }),
		{
			cacheWillUpdate: async ({ response }) =>
				response.status === 200 &&
				response.headers.get('content-type')?.toLowerCase().startsWith('text/html') &&
				(!response.url || isAppDocumentUrl(new URL(response.url)))
					? response
					: null,
		},
	],
});

const serwist = new Serwist({
	precacheEntries: self.__SW_MANIFEST,
	// Also removes next-pwa's `workbox-precache-v2-…` precache from before Serwist.
	precacheOptions: { cleanupOutdatedCaches: true },
	skipWaiting: true,
	clientsClaim: true,
	runtimeCaching: [
		{
			matcher: /^https:\/\/posters\d+\.debridmediamanager\.com\/.*$/,
			handler: new CacheFirst({
				cacheName: 'poster-images',
				plugins: [
					new ExpirationPlugin({
						maxAgeSeconds: 60 * 60 * 24 * 30,
						maxEntries: 200,
					}),
				],
			}),
		},
		{
			matcher: ({ request, url }) => request.mode === 'navigate' && isAppDocumentUrl(url),
			handler: pages,
		},
	],
	fallbacks: {
		entries: [
			{
				url: '/_offline',
				matcher: ({ request }) => request.destination === 'document',
			},
		],
	},
});

// Replace the unguarded frontend-navigation cache with the same document policy
// used for full navigations. The router sends only completed application routes.
self.addEventListener('message', (event) => {
	if (event.data?.type !== 'CACHE_APP_DOCUMENT' || typeof event.data.url !== 'string') return;
	const url = new URL(event.data.url, self.location.origin);
	if (!isAppDocumentUrl(url)) return;
	const [response, complete] = pages.handleAll({
		event,
		request: new Request(url, { headers: { Accept: 'text/html' } }),
	});
	event.waitUntil(Promise.all([response, complete]));
});

// next-pwa's runtime caches held API URLs and bodies (`others` kept every pushState
// URL, query strings included). `pages` goes too: documents cached by the previous
// build name scripts this build no longer serves.
const STALE_CACHES = ['start-url', 'next-data', 'others', 'pages'];
self.addEventListener('activate', (event) => {
	event.waitUntil(Promise.all(STALE_CACHES.map((name) => caches.delete(name))));
});

serwist.addEventListeners();
