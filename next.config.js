/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
	dest: 'public',
	register: true,
	skipWaiting: true,
	disable: process.env.NODE_ENV === 'development',
	scope: '/',
	sw: 'service-worker.js',
	cacheOnFrontEndNav: false,
	runtimeCaching: [
		// For anticors proxy requests to Real-Debrid
		// Updated for compatibility with API retry mechanism
		{
			urlPattern: /^https:\/\/proxy\d+\.debridmediamanager\.com\/.*(?<!_cache_buster=).*$/,
			handler: 'CacheFirst',
			options: {
				cacheName: 'rerender-cache',
				expiration: {
					maxAgeSeconds: 5, // Tiny cache window to absorb re-renders
				},
				// Add cache key function to respect query params
				cacheableResponse: {
					statuses: [0, 200], // Cache successful responses
				},
				// Don't cache responses with _cache_buster parameter
				matchOptions: {
					ignoreSearch: false, // Consider query params in cache key
				}
			},
		},
		// Special cache configuration for retry requests
		// Retry requests will bypass cache due to _cache_buster parameter
		{
			urlPattern: /^https:\/\/proxy\d+\.debridmediamanager\.com\/.*_cache_buster=.*$/,
			handler: 'NetworkOnly', // Always fetch from network for retry requests
			options: {
				cacheName: 'retry-requests',
				// No expiration needed for NetworkOnly strategy
			},
		},
		{
			urlPattern: /^https:\/\/posters\d+\.debridmediamanager\.com\/.*$/,
			handler: 'CacheFirst',
			options: {
				cacheName: 'poster-images',
				expiration: {
					maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
				},
			},
		},
	],
});

const nextConfig = {
	output: 'standalone',
	images: {
		unoptimized: true,
		minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
		remotePatterns: [
			{
				protocol: 'https',
				hostname: 'image.tmdb.org',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'picsum.photos',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'm.media-amazon.com',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'static.debridmediamanager.com',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'images.metahub.space',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'fakeimg.pl',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'media.kitsu.app',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'cdn.myanimelist.net',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'cdn-eu.anidb.net',
				port: '',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'posters.debridmediamanager.com',
				port: '',
				pathname: '/**',
			},
		],
	},
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		externalSearchApiHostname: process.env.EXTERNAL_SEARCH_API_HOSTNAME,
		proxy: 'https://proxy#num#.debridmediamanager.com/anticors?url=',
		realDebridHostname: 'https://api.real-debrid.com',
		realDebridClientId: 'X245A4XAIBGVM',
		allDebridHostname: 'https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
		traktClientId: '8a7455d06804b07fa25e27454706c6f2107b6fe5ed2ad805eff3b456a17e79f0',
		torboxHostname: 'https://api.torbox.app',
		patreonClientId: process.env.PATREON_CLIENT_ID,
		githubClientId: process.env.GITHUB_CLIENT_ID,
		discordClientId: process.env.DISCORD_CLIENT_ID,
	},
	webpack: (config) => {
		config.cache = {
			type: 'filesystem',
			buildDependencies: {
				config: [__filename],
			},
		};
		return config;
	},
};

module.exports = withPWA(nextConfig);