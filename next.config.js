/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		realDebridHostname: 'https://corsproxy.org/?https://api.real-debrid.com',
		allDebridHostname: 'https://corsproxy.org/?https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
	},
};

module.exports = nextConfig;
