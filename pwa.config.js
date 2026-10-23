const { randomUUID } = require('node:crypto');
const offlineRevision = randomUUID();

module.exports = {
	swSrc: 'src/service-worker.ts',
	swDest: 'public/service-worker.js',
	swUrl: '/service-worker.js',
	register: true,
	disable: process.env.NODE_ENV === 'development',
	scope: '/',
	// The app router uses the guarded service-worker document cache bridge.
	cacheOnNavigation: false,
	// node-glob does not subtract "!path" patterns; exclude the root with an extglob.
	globPublicPatterns: ['!(noprecache){,/**}'],
	// Setting exclude replaces the plugin's defaults, so restate them.
	exclude: [/\.map$/, /^manifest.*\.js$/, /dynamic-css-manifest\.json$/],
	manifestTransforms: [
		async (entries) => ({
			// Serwist uses size: 0 for external entries without a compilation asset.
			manifest: [...entries, { url: '/_offline', revision: offlineRevision, size: 0 }],
			warnings: [],
		}),
	],
};
