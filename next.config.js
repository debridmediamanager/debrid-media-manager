/** @type {import('next').NextConfig} */

const withBundleAnalyzer = require('@next/bundle-analyzer')({
	enabled: process.env.ANALYZE === 'true', // Enable analyzer when ANALYZE=true
});

const nextConfig = {
	output: 'standalone',
	images: {
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
		],
	},
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		externalSearchApiHostname: process.env.EXTERNAL_SEARCH_API_HOSTNAME,
		proxy: 'https://proxy.debridmediamanager.com/anticors?url=',
		realDebridHostname: 'https://app.real-debrid.com',
		realDebridClientId: 'X245A4XAIBGVM',
		allDebridHostname: 'https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
		traktClientId: '8a7455d06804b07fa25e27454706c6f2107b6fe5ed2ad805eff3b456a17e79f0',
	},
	experimental: {
		swcMinify: true,
	},
	webpack: (config, { isServer, dev }) => {
		// **1. Enable Webpack Caching**
		if (!isServer && !dev) {
			config.cache = {
				type: 'filesystem', // Use filesystem caching
				buildDependencies: {
					config: [__filename], // Recompile when next.config.js changes
				},
			};
		}

		// **2. Optimize Bundle Size with Bundle Analyzer**
		// Bundle Analyzer is already integrated above via withBundleAnalyzer

		// **3. Other Webpack Optimizations**

		// Split chunks for better caching
		config.optimization.splitChunks = {
			chunks: 'all',
			maxInitialRequests: Infinity,
			minSize: 20000, // 20KB
			cacheGroups: {
				vendor: {
					test: /[\\/]node_modules[\\/]/,
					name(module) {
						// Get the name of the package
						const packageName = module.context.match(
							/[\\/]node_modules[\\/](.*?)([\\/]|$)/
						)[1];
						return `npm.${packageName.replace('@', '')}`;
					},
				},
			},
		};

		return config;
	},
};

module.exports = withBundleAnalyzer(nextConfig);
