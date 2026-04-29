module.exports = {
	dest: 'public',
	register: true,
	skipWaiting: true,
	disable: process.env.NODE_ENV === 'development',
	scope: '/',
	sw: 'service-worker.js',
	cacheOnFrontEndNav: true,
	buildExcludes: [/dynamic-css-manifest\.json$/],
	runtimeCaching: [
		{
			urlPattern: /^https:\/\/posters\d+\.debridmediamanager\.com\/.*$/,
			handler: 'CacheFirst',
			options: {
				cacheName: 'poster-images',
				expiration: {
					maxAgeSeconds: 60 * 60 * 24 * 30,
					maxEntries: 200,
				},
			},
		},
	],
	fallbacks: {
		document: '/_offline',
	},
};
