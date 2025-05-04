/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
	dest: 'public',
	register: true,
	skipWaiting: true,
	// disable: process.env.NODE_ENV === 'development',
	scope: '/',
	sw: 'service-worker.js',
	cacheOnFrontEndNav: false,
	runtimeCaching: [
		// For anticors proxy requests to Real-Debrid
		{
			urlPattern: /^https:\/\/proxy\d+\.debridmediamanager\.com\/anticors\?url=.*/,
			handler: 'NetworkFirst',
			options: {
				cacheName: 'rd-api-proxied',
				expiration: {
					maxAgeSeconds: 5, // Tiny cache window to absorb re-renders
					maxEntries: 50,
				},
				networkTimeoutSeconds: 30,
			},
		},
		{
			urlPattern: /^https:\/\/posters\d+\.debridmediamanager\.com\/.*\.jpg$/,
			handler: 'CacheFirst',
			options: {
			  cacheName: 'poster-images',
			  expiration: {
				maxEntries: 200,
				maxAgeSeconds: 60 * 60 * 24 * 30,
			  },
			  cacheableResponse: {
				statuses: [0, 200],
			  },
			  cacheKeyWillBeUsed: async ({request, url}) => {
				const pathname = new URL(url).pathname;
				// Normalize cache key to just the filename
				const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
				return new Request(`https://posters.debridmediamanager.com/${filename}`);
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
