/**
 * Each DMM Cast add-on's logo: the same robot in its setup page's accent colour, so clients
 * that list add-ons side by side (Nuvio, Stremio) can tell the providers apart. The last four
 * are the yellow robot recoloured and served from public/noprecache/cast-logos.
 */
export const CAST_LOGOS = {
	rd: 'https://static.debridmediamanager.com/greenlogo.jpeg',
	tb: 'https://static.debridmediamanager.com/dmmcast.png',
	ad: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	pm: 'https://debridmediamanager.com/noprecache/cast-logos/premiumize.jpeg',
	oc: 'https://debridmediamanager.com/noprecache/cast-logos/offcloud.jpeg',
	dl: 'https://debridmediamanager.com/noprecache/cast-logos/debridlink.jpeg',
	en: 'https://debridmediamanager.com/noprecache/cast-logos/easynews.jpeg',
} as const;
