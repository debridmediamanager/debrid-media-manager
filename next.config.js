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
		  {
			protocol: 'https',
			hostname: 'static.debridmediamanager.com',
			port: '',
			pathname: '/**',
		  },
		],
	  },
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		externalSearchApiHostname: process.env.EXTERNAL_SEARCH_API_HOSTNAME,
		realDebridHostname: 'https://api.real-debrid.com',
		realDebridClientId: 'X245A4XAIBGVM',
		allDebridHostname: 'https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
		traktClientId: '8a7455d06804b07fa25e27454706c6f2107b6fe5ed2ad805eff3b456a17e79f0',
	},
};

module.exports = nextConfig;
