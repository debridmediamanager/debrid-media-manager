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

// An upgrade must also remove API URLs/bodies written by the old navigation
// cache, without clearing application documents or unrelated browser storage.
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			if (!(await caches.has('pages'))) return;
			const cache = await caches.open('pages');
			await Promise.all(
				(await cache.keys())
					.filter((request) => isApiPath(new URL(request.url).pathname))
					.map((request) => cache.delete(request))
			);
		})()
	);
});

serwist.addEventListeners();
