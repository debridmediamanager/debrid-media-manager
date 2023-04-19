/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		realDebridHostname: 'https://corsproxy.org/?https://api.real-debrid.com',
		allDebridHostname: 'https://api.alldebrid.com',
		allDebridAgent: 'debridMediaManager',
		bypassHostname: 'https://corsproxy.org/?',
	},
};

module.exports = nextConfig;
