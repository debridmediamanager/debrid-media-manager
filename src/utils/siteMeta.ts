// What search engines and link previews show for DMM. Only the home page is indexed
// (see next.config.js headers); the social tags in _document apply to every shared link.
export const SITE_URL = 'https://debridmediamanager.com/';
export const SITE_NAME = 'Debrid Media Manager';
export const HOME_TITLE = 'Debrid Media Manager · Curate an infinite media library';
export const SITE_TAGLINE = 'Build your movie and TV show library with truly unlimited storage.';
export const SITE_DESCRIPTION =
	"Build your movie and TV show library on Real-Debrid, AllDebrid, TorBox, Premiumize, Debrid-Link or Offcloud. Search, see what's cached and stream it in Kodi, Stremio, Jellyfin or Plex. Free and open source.";
export const SOCIAL_CARD = {
	url: 'https://debridmediamanager.com/social-card.png',
	width: 1200,
	height: 630,
	alt: 'Debrid Media Manager. Curate an infinite media library.',
};

// Gives Google the site name and logo it shows beside the result (instead of the bare domain).
export const HOME_STRUCTURED_DATA = [
	{
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE_NAME,
		alternateName: ['DMM'],
		url: SITE_URL,
	},
	{
		'@context': 'https://schema.org',
		'@type': 'Organization',
		name: SITE_NAME,
		url: SITE_URL,
		logo: 'https://debridmediamanager.com/android-chrome-512x512.png',
		sameAs: [
			'https://github.com/debridmediamanager/debrid-media-manager',
			'https://www.reddit.com/r/debridmediamanager/',
			'https://discord.com/invite/7u4YjMThXP',
		],
	},
];
