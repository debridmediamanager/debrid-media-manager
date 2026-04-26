import { FileData, SearchResult } from '@/services/mediasearch';
import { normalizeHash } from '@/utils/extractHashes';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';

export function useExternalSources(
	rdKey: string | null,
	adKey?: string | null,
	tbKey?: string | null
) {
	const hasAnyDebridKey = !!(rdKey || adKey || tbKey);
	const [mediafusionHash, setMediafusionHash] = useState<string>('');

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
					max_streams_per_resolution: '10',
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
			let fileSize = 0;
			let hash = '';

			if (source === 'torrentio' || source === 'peerflix') {
				// Parse Torrentio/Peerflix format
				cleanTitle = stream.title || stream.name || '';
				const titleParts = cleanTitle.split('\n');
				if (titleParts.length > 1) {
					cleanTitle = titleParts[0].trim();
				}

				const sizeMatch = stream.title?.match(/💾\s*([\d.]+)\s*(GB|MB|TB)/i);
				if (sizeMatch) {
					const size = parseFloat(sizeMatch[1]);
					if (sizeMatch[2].toUpperCase() === 'TB') {
						fileSize = size * 1024 * 1024;
					} else if (sizeMatch[2].toUpperCase() === 'GB') {
						fileSize = size * 1024;
					} else {
						fileSize = size;
					}
				}

				const hashMatch = stream.url?.match(/\/([a-fA-F0-9]{40})\//);
				hash = normalizeHash(hashMatch ? hashMatch[1] : stream.infoHash || '');
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

				const sizeMatch = stream.title?.match(/💾\s*([\d.]+)\s*(GB|MB|TB)/i);
				if (sizeMatch) {
					const size = parseFloat(sizeMatch[1]);
					if (sizeMatch[2].toUpperCase() === 'TB') {
						fileSize = size * 1024 * 1024;
					} else if (sizeMatch[2].toUpperCase() === 'GB') {
						fileSize = size * 1024;
					} else {
						fileSize = size;
					}
				}

				hash = normalizeHash(stream.infoHash || '');
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

				if (stream.behaviorHints?.videoSize) {
					fileSize = stream.behaviorHints.videoSize / (1024 * 1024);
				} else if (stream.description) {
					const sizeMatch = stream.description.match(/💾\s*([\d.]+)\s*(GB|MB|TB)/i);
					if (sizeMatch) {
						const size = parseFloat(sizeMatch[1]);
						if (sizeMatch[2].toUpperCase() === 'TB') {
							fileSize = size * 1024 * 1024;
						} else if (sizeMatch[2].toUpperCase() === 'GB') {
							fileSize = size * 1024;
						} else {
							fileSize = size;
						}
					}
				}

				hash = normalizeHash(stream.infoHash || '');
			}

			if (!hash) return null;

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
				files: files,
				noVideos: false,
				medianFileSize: fileSize,
				biggestFileSize: fileSize,
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
					// Use our proxy endpoint for Tor services
					response = await axios.get('/api/proxy/stream', {
						params: { url, service: source },
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
					url = `https://comet.elfhosted.com/realdebrid=real-debrid-key/stream/movie/${imdbId}.json`;
					break;
				case 'comet-tor':
					url = `https://comet.elfhosted.com/realdebrid=real-debrid-key/stream/movie/${imdbId}.json`;
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
		[rdKey, hasAnyDebridKey, mediafusionHash, fetchExternalSource]
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
					url = `https://comet.elfhosted.com/realdebrid=real-debrid-key/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
					break;
				case 'comet-tor':
					url = `https://comet.elfhosted.com/realdebrid=real-debrid-key/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
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
		[rdKey, hasAnyDebridKey, mediafusionHash, fetchExternalSource]
	);

	const getEnabledSources = useCallback(() => {
		const sources: Array<
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
		> = [];

		if (window.localStorage.getItem('settings:enableTorrentio') !== 'false') {
			sources.push('torrentio');
		}
		if (window.localStorage.getItem('settings:enableComet') !== 'false') {
			sources.push('comet');
		}
		if (window.localStorage.getItem('settings:enableMediaFusion') !== 'false') {
			sources.push('mediafusion');
		}
		if (window.localStorage.getItem('settings:enablePeerflix') !== 'false') {
			sources.push('peerflix');
		}
		if (window.localStorage.getItem('settings:enableTorrentsDB') !== 'false') {
			sources.push('torrentsdb');
		}

		// Add Tor variants
		if (window.localStorage.getItem('settings:enableTorrentioTor') !== 'false') {
			sources.push('torrentio-tor');
		}
		if (window.localStorage.getItem('settings:enableCometTor') !== 'false') {
			sources.push('comet-tor');
		}
		if (window.localStorage.getItem('settings:enableMediaFusionTor') !== 'false') {
			sources.push('mediafusion-tor');
		}
		if (window.localStorage.getItem('settings:enablePeerflixTor') !== 'false') {
			sources.push('peerflix-tor');
		}
		if (window.localStorage.getItem('settings:enableTorrentsDBTor') !== 'false') {
			sources.push('torrentsdb-tor');
		}

		return sources;
	}, []);

	return {
		fetchMovieFromExternalSource,
		fetchEpisodeFromExternalSource,
		getEnabledSources,
	};
}
