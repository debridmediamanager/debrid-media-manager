/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: false,
	publicRuntimeConfig: {
		// Will be available on both server and client
		realDebirdHostname: 'https://api.real-debrid.com',
	},
};

module.exports = nextConfig;
