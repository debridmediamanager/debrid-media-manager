/** @type {import('next').NextConfig} */
const pwaConfig = require('./pwa.config.js');
const withPWA = require('next-pwa')(pwaConfig);

const nextConfig = {
	output: 'standalone',
	transpilePackages: ['recharts', '@reduxjs/toolkit'],
	webpack: (config) => {
		config.cache = {
			type: 'filesystem',
			buildDependencies: {
				config: [__filename],
			},
		};
		return config;
	},
	async rewrites() {
		return [
			// Support external callers using /anticors path by rewriting to API route
			{ source: '/anticors', destination: '/api/anticors' },
			// Stremio builds resource URLs relative to the manifest base path.
			// The no-catalog manifest lives at /api/stremio*/[userid]/no-catalog/manifest.json,
			// so Stremio requests .../no-catalog/catalog/..., .../no-catalog/stream/..., etc.
			// Rewrite these back to the real endpoints.
			{
				source: '/api/stremio/:userid/no-catalog/:path*',
				destination: '/api/stremio/:userid/:path*',
			},
			{
				source: '/api/stremio-tb/:userid/no-catalog/:path*',
				destination: '/api/stremio-tb/:userid/:path*',
			},
			{
				source: '/api/stremio-ad/:userid/no-catalog/:path*',
				destination: '/api/stremio-ad/:userid/:path*',
			},
		];
	},
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
				hostname: 'live.metahub.space',
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
		// Cloudflare Worker anticors proxy (unauthenticated RD endpoints)
		proxy: 'https://anticors.debridmediamanager.com/anticors?url=',
		// Self-hosted anticors for authenticated RD endpoints (no rate limiting with API key)
		authProxy: 'https://#num#.cors.debridmediamanager.com/api/anticors?url=',
		realDebridHostname: 'https://app.real-debrid.com',
		realDebridClientId: 'X245A4XAIBGVM',
		allDebridHostname: 'https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
		traktClientId: '8a7455d06804b07fa25e27454706c6f2107b6fe5ed2ad805eff3b456a17e79f0',
		torboxHostname: 'https://api.torbox.app',
		patreonClientId: process.env.PATREON_CLIENT_ID,
		githubClientId: process.env.GITHUB_CLIENT_ID,
		discordClientId: process.env.DISCORD_CLIENT_ID,
	},
};

module.exports = withPWA(nextConfig);
