/** @type {import('next').NextConfig} */
const pwaConfig = require('./pwa.config.js');

const nextConfig = {
	output: 'standalone',
	// npm's required prebuild runs full ESLint + Oxlint before Next's type/build workers.
	// Avoid running a second, incomplete ESLint pass concurrently with type checking.
	eslint: { ignoreDuringBuilds: true },
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
		return {
			beforeFiles: [],
			afterFiles: [
				{ source: '/anticors', destination: '/api/anticors' },
				{ source: '/api-docs', destination: '/api-docs.html' },
			],
			fallback: [
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
				{
					source: '/api/stremio-pm/:userid/no-catalog/:path*',
					destination: '/api/stremio-pm/:userid/:path*',
				},
				{
					source: '/api/stremio-oc/:userid/no-catalog/:path*',
					destination: '/api/stremio-oc/:userid/:path*',
				},
				{
					source: '/api/stremio-dl/:userid/no-catalog/:path*',
					destination: '/api/stremio-dl/:userid/:path*',
				},
			],
		};
	},
	async headers() {
		// DMM stays out of search engines; this also covers API responses and static files.
		return [
			{
				source: '/:path*',
				headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
			},
		];
	},
	async redirects() {
		return [
			{
				source: '/albums',
				destination: '/music',
				permanent: false,
			},
			{
				source: '/albums/:path*',
				destination: '/music/:path*',
				permanent: false,
			},
			{
				// Removed 2026-10-03: the Patreon post is the one complete copy.
				source: '/rd-filename-filters.html',
				destination:
					'https://www.patreon.com/debridmediamanager/posts/complete-list-of-158388927',
				permanent: true,
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

module.exports = async () => {
	// Serwist is ESM-only; this Next configuration is loaded as CommonJS.
	const { default: withSerwist } = await import('@serwist/next');
	return withSerwist(pwaConfig)(nextConfig);
};
