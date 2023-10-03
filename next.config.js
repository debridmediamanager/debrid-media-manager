/** @type {import('next').NextConfig} */
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
		],
	  },
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		externalSearchApiHostname: process.env.EXTERNAL_SEARCH_API_HOSTNAME,
		realDebridHostname: 'https://corsproxy.org/?https://api.real-debrid.com',
		allDebridHostname: 'https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
		bypassHostname: 'https://corsproxy.org/?',
	},
};

module.exports = nextConfig;
