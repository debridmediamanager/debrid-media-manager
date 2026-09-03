import { FileData, SearchResult, hasSubstantialTitle } from '@/services/mediasearch';
import { getLocalStorageBoolean } from '@/utils/browserStorage';
import { normalizeHash } from '@/utils/extractHashes';
import { generateTokenAndHash } from '@/utils/token';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Addons render size as "💾 4.5 GB", but units vary between decimal (GB) and
// binary (GiB), and some locales use a comma decimal separator. Returns MB.
export function parseSizeToMb(text?: string): number {
	if (!text) return 0;
	const match = text.match(/💾\s*([\d.,]+)\s*(T|G|M)i?B/i);
	if (!match) return 0;
	const raw = match[1];
	// "1,234.5" uses commas as thousand separators; "4,5" uses one as the decimal point
	const value = parseFloat(raw.includes('.') ? raw.replace(/,/g, '') : raw.replace(',', '.'));
	if (!isFinite(value)) return 0;
	const unit = match[2].toUpperCase();
	if (unit === 'T') return value * 1024 * 1024;
	if (unit === 'G') return value * 1024;
	return value;
}

// Comet takes its settings as a base64 JSON blob in the URL path. ElfHosted
// refuses non-debrid searches, so a real debrid key is required - the old
// "realdebrid=real-debrid-key" placeholder URL returns an OBSOLETE CONFIGURATION
// stream and nothing else.
export function buildCometConfig(rdKey: string): string {
	return btoa(
		JSON.stringify({
			maxResultsPerResolution: 0,
			maxSize: 0,
			cachedOnly: false,
			sortCachedUncachedTogether: true,
			removeTrash: false,
			resultFormat: ['all'],
			debridServices: [{ service: 'realdebrid', apiKey: rdKey }],
			enableTorrent: false,
			deduplicateStreams: false,
			// never let Comet enumerate the user's own debrid library
			scrapeDebridAccountTorrents: false,
			debridStreamProxyPassword: '',
			languages: { required: [], allowed: [], exclude: [], preferred: [] },
			resolutions: {},
			options: {
				remove_ranks_under: -10000000000,
				allow_english_in_languages: false,
				remove_unknown_languages: false,
			},
		})
	);
}

export type ExternalSource =
	| 'torrentio'
	| 'comet'
	| 'mediafusion'
	| 'peerflix'
	| 'torrentsdb'
	| 'torrentio-tor'
	| 'comet-tor'
	| 'mediafusion-tor'
	| 'peerflix-tor'
	| 'torrentsdb-tor';

/**
 * Single source of truth for which addons a search queries.
 * `defaultEnabled` must stay in step with the settings screen - the Tor variants
 * are opt-in there, so they are opt-in here.
 */
export const EXTERNAL_SOURCE_SETTINGS: {
	key: string;
	source: ExternalSource;
	defaultEnabled: boolean;
}[] = [
	{ key: 'settings:enableTorrentio', source: 'torrentio', defaultEnabled: true },
	{ key: 'settings:enableComet', source: 'comet', defaultEnabled: true },
	{ key: 'settings:enableMediaFusion', source: 'mediafusion', defaultEnabled: true },
	{ key: 'settings:enablePeerflix', source: 'peerflix', defaultEnabled: true },
	{ key: 'settings:enableTorrentsDB', source: 'torrentsdb', defaultEnabled: true },
	{ key: 'settings:enableTorrentioTor', source: 'torrentio-tor', defaultEnabled: false },
	{ key: 'settings:enableCometTor', source: 'comet-tor', defaultEnabled: false },
	{ key: 'settings:enableMediaFusionTor', source: 'mediafusion-tor', defaultEnabled: false },
	{ key: 'settings:enablePeerflixTor', source: 'peerflix-tor', defaultEnabled: false },
	{ key: 'settings:enableTorrentsDBTor', source: 'torrentsdb-tor', defaultEnabled: false },
];

export function useExternalSources(
	rdKey: string | null,
	adKey?: string | null,
	tbKey?: string | null
) {
	const hasAnyDebridKey = !!(rdKey || adKey || tbKey);
	const [mediafusionHash, setMediafusionHash] = useState<string>('');
	const cometConfig = useMemo(() => (rdKey ? buildCometConfig(rdKey) : ''), [rdKey]);

	// Get or generate MediaFusion hash
	useEffect(() => {
		async function getHash() {
			const cacheKey = 'mediafusion_hash';
			const cachedData = localStorage.getItem(cacheKey);

			if (cachedData) {
				// Handle old format (JSON object) and new format (plain string)
				try {
					const parsed = JSON.parse(cachedData);
					if (parsed.hash) {
						// Old format - extract hash and update storage
						localStorage.setItem(cacheKey, parsed.hash);
						setMediafusionHash(parsed.hash);
						return;
					}
				} catch (e) {
					// Not JSON, assume it's already a plain string
					setMediafusionHash(cachedData);
					return;
				}
			}

			// Generate new hash
			try {
				const config = {
					streaming_provider: null,
					selected_catalogs: [],
					selected_resolutions: [
						'4k',
						'2160p',
						'1440p',
						'1080p',
						'720p',
						'576p',
						'480p',
						'360p',
						'240p',
						null,
					],
					enable_catalogs: true,
					enable_imdb_metadata: false,
					max_size: 'inf',
					// Must be a number - MediaFusion rejects the whole config with
					// "invalid type: string, expected u32" if this is quoted
					max_streams_per_resolution: 10,
					torrent_sorting_priority: [
						{ key: 'language', direction: 'desc' },
						{ key: 'cached', direction: 'desc' },
						{ key: 'resolution', direction: 'desc' },
						{ key: 'quality', direction: 'desc' },
						{ key: 'size', direction: 'desc' },
						{ key: 'seeders', direction: 'desc' },
						{ key: 'created_at', direction: 'desc' },
					],
					show_full_torrent_name: true,
					show_language_country_flag: false,
					nudity_filter: ['Disable'],
					certification_filter: ['Disable'],
					language_sorting: [
						'English',
						'Tamil',
						'Hindi',
						'Malayalam',
						'Kannada',
						'Telugu',
						'Chinese',
						'Russian',
						'Arabic',
						'Japanese',
						'Korean',
						'Taiwanese',
						'Latino',
						'French',
						'Spanish',
						'Portuguese',
						'Italian',
						'German',
						'Ukrainian',
						'Polish',
						'Czech',
						'Thai',
						'Indonesian',
						'Vietnamese',
						'Dutch',
						'Bengali',
						'Turkish',
						'Greek',
						'Swedish',
						'Romanian',
						'Hungarian',
						'Finnish',
						'Norwegian',
						'Danish',
						'Hebrew',
						'Lithuanian',
						'Punjabi',
						'Marathi',
						'Gujarati',
						'Bhojpuri',
						'Nepali',
						'Urdu',
						'Tagalog',
						'Filipino',
						'Malay',
						'Mongolian',
						'Armenian',
						'Georgian',
						null,
					],
					quality_filter: [
						'BluRay/UHD',
						'WEB/HD',
						'DVD/TV/SAT',
						'CAM/Screener',
						'Unknown',
					],
					api_password: null,
					mediaflow_config: null,
					rpdb_config: null,
					live_search_streams: false,
					contribution_streams: false,
					mdblist_config: null,
				};

				const response = await axios.post(
					'https://mediafusion.elfhosted.com/encrypt-user-data',
					config,
					{ headers: { 'content-type': 'application/json' } }
				);

				if (response.data?.encrypted_str) {
					// Cache the hash permanently
					localStorage.setItem(cacheKey, response.data.encrypted_str);
					setMediafusionHash(response.data.encrypted_str);
				}
			} catch (error) {
				console.error('Error generating MediaFusion hash:', error);
			}
		}

		getHash();
	}, []);

	const transformExternalStream = useCallback(
		(stream: any, source: string): SearchResult | null => {
			let cleanTitle = '';

			if (source === 'torrentio' || source === 'peerflix') {
				// Parse Torrentio/Peerflix format
				cleanTitle = stream.title || stream.name || '';
				const titleParts = cleanTitle.split('\n');
				if (titleParts.length > 1) {
					cleanTitle = titleParts[0].trim();
				}
			} else if (source === 'torrentsdb') {
				// Parse TorrentsDB format
				if (stream.title) {
					const lines = stream.title.split('\n');
					if (lines.length > 0) {
						cleanTitle = lines[0].trim();
					}
				}
				if (!cleanTitle && stream.name) {
					const nameParts = stream.name.split('\n');
					cleanTitle = nameParts[nameParts.length - 1].trim();
				}
			} else {
				// Parse Comet/MediaFusion format
				if (stream.description) {
					const lines = stream.description.split('\n');
					if (lines.length > 0) {
						cleanTitle = lines[0]
							.replace(/^\[TORRENT🧲\]\s*/, '')
							.replace(/^📂\s*/, '')
							.replace(/^📄\s*/, '')
							.trim();
					}
				}
				if (!cleanTitle) {
					cleanTitle = stream.behaviorHints?.filename || stream.name || '';
				}
			}

			// Prefer the exact byte count when the addon reports one, then fall back to
			// the 💾 field on either the title or the description. Addons are
			// inconsistent about which of the two carries it, and some (Peerflix on
			// non-cached results) omit it entirely - those land on 0 and get repaired
			// by the debrid availability check.
			const videoSize = stream.behaviorHints?.videoSize;
			const fileSize = videoSize
				? videoSize / (1024 * 1024)
				: parseSizeToMb(stream.title) || parseSizeToMb(stream.description);

			// Debrid-resolving addons drop infoHash and hand out an opaque playback
			// URL, but the hash is still recoverable from the URL path or bingeGroup.
			const hashFromUrl = stream.url?.match(/\/([a-fA-F0-9]{40})\//)?.[1];
			const hashFromBingeGroup =
				stream.behaviorHints?.bingeGroup?.match(/[a-fA-F0-9]{40}/)?.[0];
			const hash = normalizeHash(hashFromUrl || stream.infoHash || hashFromBingeGroup || '');

			if (!hash) return null;
			if (!hasSubstantialTitle(cleanTitle)) return null;

			const filename = stream.behaviorHints?.filename || cleanTitle;
			const files: FileData[] = [];
			if (filename) {
				files.push({
					fileId: stream.fileIdx || 0,
					filename: filename,
					filesize: stream.behaviorHints?.videoSize || fileSize * 1024 * 1024,
				});
			}

			return {
				title: cleanTitle,
				fileSize: fileSize,
				hash: hash,
				rdAvailable: false,
				adAvailable: false,
				tbAvailable: false,
				pmAvailable: false,
				ocAvailable: false,
				files: files,
				noVideos: false,
				medianFileSize: fileSize,
				biggestFileSize: fileSize,
				meanFileSize: fileSize,
				videoCount: 1,
				imdbId: '',
			};
		},
		[]
	);

	const fetchExternalSource = useCallback(
		async (url: string, source: string, imdbId: string): Promise<SearchResult[]> => {
			if (!hasAnyDebridKey) return [];

			try {
				let response;
				const isTorService = source.includes('-tor');

				if (isTorService) {
					// Use our proxy endpoint for Tor services. It only answers
					// callers carrying a token the server signed, so that the Tor
					// circuit it opens is spent on this site's own searches.
					const [dmmProblemKey, solution] = await generateTokenAndHash();
					response = await axios.get('/api/proxy/stream', {
						params: { url, service: source, dmmProblemKey, solution },
						timeout: 30000,
					});
				} else {
					// Direct request for non-Tor services
					response = await axios.get(url, { timeout: 3000 });
				}

				if (response.data?.streams && response.data.streams.length > 0) {
					const transformedResults: SearchResult[] = response.data.streams
						.map((stream: any) => {
							const result = transformExternalStream(stream, source);
							if (result) {
								result.imdbId = imdbId;
							}
							return result;
						})
						.filter((r: SearchResult | null) => r !== null);

					return transformedResults;
				}
				return [];
			} catch (error) {
				// Silently fail - external sources are supplementary
				return [];
			}
		},
		[hasAnyDebridKey, transformExternalStream]
	);

	const fetchMovieFromExternalSource = useCallback(
		async (
			imdbId: string,
			source:
				| 'torrentio'
				| 'comet'
				| 'mediafusion'
				| 'peerflix'
				| 'torrentsdb'
				| 'torrentio-tor'
				| 'comet-tor'
				| 'mediafusion-tor'
				| 'peerflix-tor'
				| 'torrentsdb-tor'
		): Promise<SearchResult[]> => {
			let url = '';

			switch (source) {
				case 'torrentio':
					url = `https://torrentio.strem.fun/realdebrid=real-debrid-key/stream/movie/${imdbId}.json`;
					break;
				case 'torrentio-tor':
					url = `https://torrentio.strem.fun/realdebrid=real-debrid-key/stream/movie/${imdbId}.json`;
					break;
				case 'comet':
				case 'comet-tor':
					if (!cometConfig) return [];
					url = `https://comet.elfhosted.com/${cometConfig}/stream/movie/${imdbId}.json`;
					break;
				case 'mediafusion':
					if (!mediafusionHash) return [];
					url = `https://mediafusion.elfhosted.com/${mediafusionHash}/stream/movie/${imdbId}.json`;
					break;
				case 'mediafusion-tor':
					if (!mediafusionHash) return [];
					url = `https://mediafusion.elfhosted.com/${mediafusionHash}/stream/movie/${imdbId}.json`;
					break;
				case 'peerflix':
					url = `https://addon.peerflix.mov/realdebrid=real-debrid-key/stream/movie/${imdbId}.json`;
					break;
				case 'peerflix-tor':
					url = `https://addon.peerflix.mov/realdebrid=real-debrid-key/stream/movie/${imdbId}.json`;
					break;
				case 'torrentsdb':
					if (!rdKey) return [];
					url = `https://torrentsdb.com/${rdKey}/stream/movie/${imdbId}.json`;
					break;
				case 'torrentsdb-tor':
					if (!rdKey) return [];
					url = `https://torrentsdb.com/${rdKey}/stream/movie/${imdbId}.json`;
					break;
			}

			return fetchExternalSource(url, source, imdbId);
		},
		[rdKey, hasAnyDebridKey, cometConfig, mediafusionHash, fetchExternalSource]
	);

	const fetchEpisodeFromExternalSource = useCallback(
		async (
			imdbId: string,
			seasonNum: number,
			episodeNum: number,
			source:
				| 'torrentio'
				| 'comet'
				| 'mediafusion'
				| 'peerflix'
				| 'torrentsdb'
				| 'torrentio-tor'
				| 'comet-tor'
				| 'mediafusion-tor'
				| 'peerflix-tor'
				| 'torrentsdb-tor'
		): Promise<SearchResult[]> => {
			let url = '';

			switch (source) {
				case 'torrentio':
					url = `https://torrentio.strem.fun/realdebrid=real-debrid-key/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'torrentio-tor':
					url = `https://torrentio.strem.fun/realdebrid=real-debrid-key/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'comet':
				case 'comet-tor':
					if (!cometConfig) return [];
					url = `https://comet.elfhosted.com/${cometConfig}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'mediafusion':
					if (!mediafusionHash) return [];
					url = `https://mediafusion.elfhosted.com/${mediafusionHash}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'mediafusion-tor':
					if (!mediafusionHash) return [];
					url = `https://mediafusion.elfhosted.com/${mediafusionHash}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'peerflix':
					url = `https://addon.peerflix.mov/realdebrid=real-debrid-key/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'peerflix-tor':
					url = `https://addon.peerflix.mov/realdebrid=real-debrid-key/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'torrentsdb':
					if (!rdKey) return [];
					url = `https://torrentsdb.com/${rdKey}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'torrentsdb-tor':
					if (!rdKey) return [];
					url = `https://torrentsdb.com/${rdKey}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
			}

			return fetchExternalSource(url, source, imdbId);
		},
		[rdKey, hasAnyDebridKey, cometConfig, mediafusionHash, fetchExternalSource]
	);

	const getEnabledSources = useCallback(() => {
		const sources: ExternalSource[] = [];

		// Same helper and the same defaults the settings screen uses. These used to
		// be raw `getItem(...) !== 'false'` checks, which treats "never set" as
		// enabled - so the five Tor variants, which settings shows as off by
		// default, were being queried by anyone who had not explicitly toggled them.
		for (const { key, source, defaultEnabled } of EXTERNAL_SOURCE_SETTINGS) {
			if (getLocalStorageBoolean(key, defaultEnabled)) {
				sources.push(source);
			}
		}

		return sources;
	}, []);

	return {
		fetchMovieFromExternalSource,
		fetchEpisodeFromExternalSource,
		getEnabledSources,
	};
}
