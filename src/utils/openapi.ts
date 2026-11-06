import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/configs';
import { SAB_DAILY } from '@/services/sabnzbdProxy';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';

// The OpenAPI 3.1 document /api-docs renders and /api/openapi.json serves: every
// DMM endpoint meant for another program to call. The routes the site calls for
// itself (problem-token searches, availability checks, OAuth, Cast internals) and
// the fleet's secret-gated ones stay out of it on purpose. Limits are read from
// the configs the routes enforce, so the document cannot drift from them.

type Limit = { rateLimit: number; windowSeconds: number };

const per = ({ rateLimit, windowSeconds }: Limit, unit: string) =>
	`${rateLimit.toLocaleString('en-US')} ${unit} per ${
		windowSeconds === 1
			? 'second'
			: windowSeconds === 60
				? 'minute'
				: windowSeconds === 3600
					? 'hour'
					: windowSeconds === 86400
						? 'day'
						: `${windowSeconds}s`
	}`;

const {
	newznabSearch,
	newznabGrab,
	newznabGrabDay,
	torznabSearch,
	zurg,
	identifyHashes,
	metadata,
	sponsorIdentify,
	sponsorAvailability,
	sponsorMediaInfo,
	sponsorProbes,
	sponsorPlace,
	sponsorWanted,
	animeEntries,
	takedown,
	stream,
} = RATE_LIMIT_CONFIGS;

const perAddress = per(RATE_LIMIT_CONFIGS.default, 'requests');

const REPO = 'https://github.com/debridmediamanager/debrid-media-manager/blob/main/docs';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, example?: unknown) => ({
	'application/json': example === undefined ? { schema } : { schema, example },
});
const ok = (description: string, schema: object, example?: unknown) => ({
	description,
	content: json(schema, example),
});
const body = (schema: object, example: unknown) => ({
	required: true,
	content: json(schema, example),
});
const errors = (...codes: string[]) =>
	Object.fromEntries(codes.map((code) => [code, { $ref: `#/components/responses/${code}` }]));

const HASH = 'f0ec5bc0e0a8d1cdfe6bc0c5ce4c5be39a9e2c6a';
const hashes = (max: number) => ({
	type: 'array',
	items: ref('InfoHash'),
	minItems: 1,
	maxItems: max,
});

const sponsorKey = [{ dmmApiKey: [] }];
const sponsorQuery = [{ apikeyQuery: [] }];

export const openApiDocument = {
	openapi: '3.1.0',
	info: {
		title: 'Debrid Media Manager API',
		version: '1.0.0',
		license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
		description: [
			'Endpoints your own apps and tools can call. This document is at [/api/openapi.json](/api/openapi.json) for code generators and API clients.',
			'',
			`Operations tagged **Sponsors** take the 64-character DMM API key you get by connecting your GitHub account on [gatekeeper](${GATEKEEPER_URL}). The key stops working the moment the sponsorship lapses (401 \`Sponsorship is no longer active\`).`,
			'',
			'Limits count per address unless an operation says per key, and a refused call answers 429 with `Retry-After`. Errors answer `{"error": "..."}` except on the Torznab, Newznab and SABnzbd routes, which answer in their own protocol.',
		].join('\n'),
	},
	servers: [{ url: 'https://debridmediamanager.com' }],
	// Sponsor groups first: the reference opens on its first tag.
	tags: [
		{
			name: 'Sponsors',
			description: `Need an active sponsorship's DMM API key from [gatekeeper](${GATEKEEPER_URL}).`,
		},
		{
			name: 'Metadata',
			description: 'Sponsor endpoints implementing the open Metadata API.',
			externalDocs: { url: `${REPO}/metadata-api.md`, description: 'Metadata API spec' },
		},
		{
			name: 'Indexers and plugins',
			description: 'Sponsor endpoints that speak another program’s protocol.',
		},
		{ name: 'Open', description: 'No sponsorship needed.' },
	],
	paths: {
		'/api/stremio/{userid}/manifest.json': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'stremioManifest',
				summary: 'DMM Cast addon for Stremio',
				description: `Your DMM Cast addon manifest. TorBox, AllDebrid, Premiumize, Debrid-Link and Offcloud have their own under \`/api/stremio-tb\`, \`-ad\`, \`-pm\`, \`-dl\` and \`-oc\`. Stremio then calls the addon's catalog, meta and stream routes beside it.\n\n**Limit:** ${stream.rateLimit} stream list per title every ${stream.windowSeconds}s.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/stremio',
					description: 'DMM Cast',
				},
				parameters: [
					{
						name: 'userid',
						in: 'path',
						required: true,
						description: 'The id in your install link',
						schema: { type: 'string' },
					},
				],
				responses: {
					'200': ok('A Stremio addon manifest', { type: 'object' }),
				},
			},
		},
		'/api/sabnzbd/{mountRoot}/api': {
			parameters: [
				{
					name: 'mountRoot',
					in: 'path',
					required: true,
					description:
						'Your zurg/rclone mount root, slashes included (`mnt/zurg/__all__`), so the *arr can import the finished release',
					schema: { type: 'string' },
				},
				{ name: 'mode', in: 'query', required: true, schema: { type: 'string' } },
				{
					name: 'apikey',
					in: 'query',
					required: true,
					description: 'Your Real-Debrid API key',
					schema: { type: 'string' },
				},
				{
					name: 'ma_password',
					in: 'query',
					description: 'Sponsors: your DMM API key',
					schema: { type: 'string' },
				},
			],
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'sabnzbdApi',
				summary: 'SABnzbd download client',
				description: `A SABnzbd API for Sonarr and Radarr: \`version\`, \`get_config\`, \`queue\`, \`history\` and their deletes. Grabs are rebuilt as torrents in your Real-Debrid account, under the same daily allowance as DMM's own pages: ${SAB_DAILY.normal} of Usenet per account, ${SAB_DAILY.sponsor} and a place ahead in the queue for sponsors, while the sponsorship is active.\n\nIn the *arr, set Host \`debridmediamanager.com\`, port 443 with SSL, URL Base \`api/sabnzbd/<mount root>\`, your Real-Debrid API key as the API Key, and (sponsors) your DMM API key as the Password.\n\n**Limit:** ${perAddress}.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/sabnzbd',
					description: 'SABnzbd setup',
				},
				responses: { '200': ok('SABnzbd JSON', { type: 'object' }) },
			},
			post: {
				tags: ['Open'],
				security: [],
				operationId: 'sabnzbdAddFile',
				summary: 'Add an NZB (mode=addfile)',
				description:
					'The multipart NZB upload SABnzbd clients send; the same query parameters as GET.',
				requestBody: {
					required: true,
					content: {
						'multipart/form-data': {
							schema: {
								type: 'object',
								properties: { name: { type: 'string', format: 'binary' } },
							},
						},
					},
				},
				responses: {
					'200': ok('SABnzbd JSON', { type: 'object' }),
					'413': { description: 'NZB is too large' },
				},
			},
		},
		'/api/takedown': {
			post: {
				tags: ['Open'],
				security: [],
				operationId: 'fileTakedown',
				summary: 'File a copyright notice',
				description: `Notices wait for review before anything is removed.\n\n**Limit:** ${per(takedown, 'notices')}.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/copyright',
					description: 'Notice form',
				},
				requestBody: body(
					{
						type: 'object',
						required: [
							'claimantName',
							'claimantEmail',
							'work',
							'reason',
							'goodFaith',
							'accurate',
						],
						properties: {
							claimantName: { type: 'string', maxLength: 200 },
							claimantEmail: { type: 'string', format: 'email', maxLength: 320 },
							representing: { type: 'string', maxLength: 200 },
							work: {
								type: 'string',
								maxLength: 10000,
								description: 'The work the notice concerns',
							},
							reason: { type: 'string', maxLength: 10000 },
							locations: {
								type: 'string',
								description:
									'Info hashes, magnet links or hash list URLs, any layout',
							},
							releaseNames: {
								type: 'string',
								description: 'Release names, one per line',
							},
							goodFaith: { const: true },
							accurate: { const: true },
						},
					},
					{
						claimantName: 'Jane Doe',
						claimantEmail: 'jane@example.com',
						work: 'Example Film (2024)',
						reason: 'Distributed without permission.',
						locations: `magnet:?xt=urn:btih:${HASH}`,
						goodFaith: true,
						accurate: true,
					}
				),
				responses: {
					'201': ok('Filed', {
						type: 'object',
						properties: {
							id: { type: 'string' },
							hashes: { type: 'integer' },
							releases: { type: 'integer' },
							hashlists: { type: 'integer' },
						},
					}),
					...errors('400', '429'),
					'413': {
						description: 'Over 5,000 items; split the notice',
						content: json(ref('Error')),
					},
				},
			},
		},
		'/api/search/title': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'searchTitles',
				summary: 'Find a title by name',
				description:
					"Movies and shows from IMDb's title list whose name matches `keyword`, best match first. A year at the end of the keyword (`matrix 1999`) narrows it. Use the `imdbid` with the sponsor endpoints or Torznab.",
				parameters: [
					{
						name: 'keyword',
						in: 'query',
						required: true,
						schema: { type: 'string' },
						example: 'the matrix 1999',
					},
				],
				responses: {
					'200': ok(
						'Matches',
						{
							type: 'object',
							properties: {
								results: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											imdbid: { type: 'string' },
											type: { enum: ['movie', 'show'] },
											title: { type: 'string' },
											year: { type: ['integer', 'null'] },
											score: {
												type: 'number',
												description:
													'How well the name matches, 100 at best',
											},
											score_average: {
												type: ['number', 'null'],
												description: 'IMDb rating',
											},
										},
									},
								},
							},
						},
						{
							results: [
								{
									imdbid: 'tt0133093',
									type: 'movie',
									title: 'The Matrix',
									year: 1999,
									score: 100,
									score_average: 8.7,
								},
							],
						}
					),
					'400': {
						description:
							'No `keyword`; answers `{"status": "error", "errorMessage": "..."}`',
					},
				},
			},
		},
		'/api/browse/top': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'browseTop',
				summary: 'Popular lists',
				description:
					"Four of MDBList's top lists (streaming services' top titles, critics' picks), a different four every five minutes, up to 16 titles each. Keys are list names; values are `movie:tt…` or `show:tt…`.",
				responses: {
					'200': ok(
						'List name to its titles',
						{
							type: 'object',
							additionalProperties: {
								type: 'array',
								items: { type: 'string', pattern: '^(movie|show):tt\\d+$' },
							},
						},
						{
							'Netflix Shows': ['show:tt0903747'],
							'Amazon Prime Movies': ['movie:tt0133093'],
						}
					),
				},
			},
		},
		'/api/browse/recent': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'browseRecent',
				summary: 'Titles with new releases',
				description:
					'The titles whose releases DMM most recently refreshed, newest first, as `movie:tt…` or `tv:tt…`.',
				responses: {
					'200': ok(
						'Titles, newest first',
						{
							type: 'array',
							items: { type: 'string', pattern: '^(movie|tv):tt\\d+$' },
						},
						['movie:tt0133093', 'tv:tt0903747']
					),
				},
			},
		},
		'/api/calendar': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'calendar',
				summary: 'Episodes airing',
				description:
					"Episodes airing each day from `start`, from Trakt's calendar, plus TMDB's airing-today and on-the-air shows. Each range is cached for an hour.",
				parameters: [
					{
						name: 'start',
						in: 'query',
						description: 'First day, `YYYY-MM-DD`; today (UTC) when absent',
						schema: { type: 'string', format: 'date' },
					},
					{
						name: 'days',
						in: 'query',
						schema: { type: 'integer', minimum: 1, maximum: 31, default: 7 },
					},
				],
				responses: {
					'200': ok('Days and their episodes', {
						type: 'object',
						properties: {
							range: {
								type: 'object',
								properties: {
									start: { type: 'string' },
									days: { type: 'integer' },
								},
							},
							days: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										date: { type: 'string', format: 'date' },
										items: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													title: { type: 'string' },
													season: { type: 'integer' },
													episode: { type: 'integer' },
													firstAired: {
														type: 'string',
														format: 'date-time',
													},
													isPremiere: { type: 'boolean' },
													ids: {
														type: 'object',
														description:
															'`imdb`, `tmdb`, `tvdb`, `trakt` where known',
													},
													network: { type: ['string', 'null'] },
													country: { type: ['string', 'null'] },
												},
											},
										},
									},
								},
							},
							tmdb: {
								type: 'object',
								description:
									"TMDB's `airingToday` and `onTheAir` lists, in TMDB's shape",
							},
						},
					}),
				},
			},
		},
		'/api/related/{mediaType}': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'relatedTitles',
				summary: 'Related titles',
				description: "Titles like this one, from Trakt's related list, cached per title.",
				parameters: [
					{
						name: 'mediaType',
						in: 'path',
						required: true,
						schema: { enum: ['movie', 'show'] },
					},
					{
						name: 'imdbId',
						in: 'query',
						required: true,
						schema: { type: 'string', pattern: '^tt\\d+$' },
						example: 'tt0903747',
					},
				],
				responses: {
					'200': ok(
						'Related titles',
						{
							type: 'object',
							properties: {
								source: { type: 'string' },
								results: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											title: { type: 'string' },
											year: { type: ['integer', 'null'] },
											ids: {
												type: 'object',
												description:
													'`imdb`, `tmdb`, `tvdb`, `trakt`, `slug` where known',
											},
										},
									},
								},
							},
						},
						{
							source: 'trakt',
							results: [
								{
									title: 'Narcos',
									year: 2015,
									ids: { imdb: 'tt2707408', tmdb: 63351 },
								},
							],
						}
					),
					'400': {
						description:
							'A `mediaType` other than `movie` or `show`, or no `imdbId`; answers `{"message": "..."}`',
					},
				},
			},
		},
		'/api/anime/recent': {
			get: {
				tags: ['Open'],
				security: [],
				operationId: 'recentAnime',
				summary: 'Anime with new releases',
				description: `The 48 anime that most recently got a release, newest first, with their AniDB, Kitsu and MyAnimeList ids.\n\n**Limit:** ${per(animeEntries, 'requests')}.`,
				responses: {
					'200': ok('Anime, newest first', {
						type: 'object',
						properties: {
							results: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										anidb_id: { type: 'integer' },
										kitsu_id: { type: ['integer', 'null'] },
										mal_id: { type: ['integer', 'null'] },
										imdb_id: { type: ['string', 'null'] },
										title: { type: 'string' },
										type: { type: 'string' },
										poster_url: { type: ['string', 'null'] },
									},
								},
							},
						},
					}),
					...errors('429'),
				},
			},
		},
		'/api/sponsor/identify': {
			post: {
				tags: ['Sponsors'],
				operationId: 'identifyFilenames',
				summary: 'Identify releases by filename',
				description: `Works out the movie or show from each release filename, the same way your library page does, so it answers for releases DMM has never seen. With a hash, answers are cached and DMM's own hash map can confirm a title.\n\n\`results\` lines up with \`items\`; an entry is \`null\` when DMM is not sure enough to name it. \`complete: false\` means the identifier was unreachable: ask again later for the \`null\` rows.\n\n**Limit:** ${per(sponsorIdentify, 'calls')}.`,
				externalDocs: { url: `${REPO}/sponsor-api.md`, description: 'Sponsor API' },
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['items'],
						properties: {
							items: {
								type: 'array',
								minItems: 1,
								maxItems: 500,
								items: {
									type: 'object',
									required: ['filename'],
									properties: {
										filename: {
											type: 'string',
											description: 'Read up to 512 characters',
										},
										hash: ref('InfoHash'),
									},
								},
							},
						},
					},
					{ items: [{ filename: 'The.Matrix.1999.1080p.BluRay.x264', hash: HASH }] }
				),
				responses: {
					'200': ok(
						'One result per item, in order',
						{
							type: 'object',
							properties: {
								results: {
									type: 'array',
									items: { oneOf: [ref('Identification'), { type: 'null' }] },
								},
								complete: { type: 'boolean' },
							},
						},
						{
							results: [
								{
									imdbId: 'tt0133093',
									title: 'The Matrix',
									year: 1999,
									kind: 'movie',
								},
							],
							complete: true,
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/torrents/identify': {
			post: {
				tags: ['Sponsors'],
				operationId: 'identifyHashes',
				summary: 'Identify releases by hash',
				description: `The title DMM already has on record for each release hash, without reading any filename. Hashes DMM has never seen are left out, so use \`/api/sponsor/identify\` for those.\n\n**Limit:** ${per(identifyHashes, 'calls')}.`,
				security: sponsorKey,
				requestBody: body(
					{ type: 'object', required: ['hashes'], properties: { hashes: hashes(500) } },
					{ hashes: [HASH] }
				),
				responses: {
					'200': ok(
						'Known hashes only',
						{
							type: 'object',
							properties: {
								identities: {
									type: 'object',
									additionalProperties: {
										type: 'object',
										properties: {
											imdbId: { type: 'string' },
											title: { type: ['string', 'null'] },
											year: { type: ['integer', 'null'] },
										},
									},
								},
							},
						},
						{
							identities: {
								[HASH]: { imdbId: 'tt0133093', title: 'The Matrix', year: 1999 },
							},
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/sponsor/availability': {
			post: {
				tags: ['Sponsors'],
				operationId: 'checkAvailability',
				summary: 'Cached availability DMM has seen',
				description: `Which hashes DMM users have found cached on Real-Debrid (\`rd\`), AllDebrid (\`ad\`) or Debrid-Link (\`dl\`), with their files. \`imdbId\` limits the answer to that title. A hash missing from \`available\` has not been seen cached, which does not mean it is not.\n\n**Limit:** ${per(sponsorAvailability, 'calls')}.`,
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['service', 'hashes'],
						properties: {
							service: { enum: ['rd', 'ad', 'dl'] },
							imdbId: { type: 'string', pattern: '^tt\\d+$' },
							hashes: hashes(100),
						},
					},
					{ service: 'rd', imdbId: 'tt0133093', hashes: [HASH] }
				),
				responses: {
					'200': ok('Hashes seen cached', {
						type: 'object',
						properties: {
							available: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										hash: ref('InfoHash'),
										filename: {
											type: 'string',
											description: 'Real-Debrid without imdbId only',
										},
										originalFilename: {
											type: 'string',
											description: 'Real-Debrid without imdbId only',
										},
										files: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													file_id: { type: 'integer' },
													path: { type: 'string' },
													bytes: { type: 'integer' },
												},
											},
										},
									},
								},
							},
						},
					}),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/sponsor/mediainfo': {
			post: {
				tags: ['Sponsors'],
				operationId: 'storedMediaInfo',
				summary: 'Stored media info',
				description: `The ffprobe output zurg users and sponsors' apps have already shared for each release hash: streams, codecs, languages, HDR and duration per file, so your tools need not download anything to read them. \`MediaInfo\` is ffprobe's own JSON (\`-show_format -show_streams\`). A probe describes the file at \`path\` with that exact size, so match on both; a probe an app sent (\`/api/sponsor/probes\`) has only the file's name for its path, or an empty one when the app did not know it, so match those on the size. Hashes nobody has probed are left out, and so are files inside archives and Usenet releases.\n\n**Limit:** ${per(sponsorMediaInfo, 'calls')}.`,
				security: sponsorKey,
				requestBody: body(
					{ type: 'object', required: ['hashes'], properties: { hashes: hashes(100) } },
					{ hashes: [HASH] }
				),
				responses: {
					'200': ok(
						'Probed hashes only',
						{
							type: 'object',
							properties: {
								releases: {
									type: 'object',
									additionalProperties: {
										type: 'object',
										properties: {
											files: {
												type: 'object',
												additionalProperties: {
													type: 'object',
													properties: {
														path: { type: 'string' },
														bytes: { type: 'integer' },
														MediaInfo: {
															type: 'object',
															description: 'ffprobe JSON',
														},
													},
												},
											},
										},
									},
								},
							},
						},
						{
							releases: {
								[HASH]: {
									files: {
										'1': {
											path: '/The.Matrix.1999.mkv',
											bytes: 15237850498,
											MediaInfo: { streams: [], format: {} },
										},
									},
								},
							},
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/sponsor/probes': {
			post: {
				tags: ['Sponsors'],
				operationId: 'shareProbes',
				summary: 'Share probes',
				description: `Send the ffprobe output your tool took of single files of torrents, and \`/api/sponsor/mediainfo\` answers it to every sponsor: the next one to meet that file skips its probe. Each probe names the torrent's info hash, the file's exact size in \`bytes\` and, if you know it, the file's \`name\`. \`MediaInfo\` is ffprobe's JSON (\`-show_format -show_streams\`, \`-show_chapters\` welcome), at most 256 KB, with its \`format.size\` equal to \`bytes\` when it has one; the address it read is dropped.\n\nThe first probe sent for a file (hash and size) is kept: a later one is counted in \`known\` and changes nothing, and zurg's own snapshot of a release is answered before any probe an app sent. \`rejected\` names each refused probe by its place in the list, the others are kept.\n\n**Limit:** ${per(sponsorProbes, 'calls')} per key.`,
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['probes'],
						properties: {
							probes: {
								type: 'array',
								minItems: 1,
								maxItems: 100,
								items: {
									type: 'object',
									required: ['hash', 'bytes', 'MediaInfo'],
									properties: {
										hash: { type: 'string', pattern: '^[a-fA-F0-9]{40}$' },
										bytes: { type: 'integer', minimum: 1 },
										name: { type: 'string', maxLength: 512 },
										MediaInfo: { type: 'object', description: 'ffprobe JSON' },
									},
								},
							},
						},
					},
					{
						probes: [
							{
								hash: HASH,
								bytes: 129241752,
								name: 'Sintel.mp4',
								MediaInfo: { streams: [], format: {} },
							},
						],
					}
				),
				responses: {
					'200': ok(
						'What was kept',
						{
							type: 'object',
							properties: {
								saved: {
									type: 'integer',
									description: 'Probes of files DMM had none for',
								},
								known: {
									type: 'integer',
									description: 'Probes of files DMM already holds one for',
								},
								rejected: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											index: { type: 'integer' },
											error: { type: 'string' },
										},
									},
								},
							},
						},
						{ saved: 1, known: 0 }
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/sponsor/place': {
			post: {
				tags: ['Sponsors'],
				operationId: 'placeReleases',
				summary: 'Place releases on TMDB',
				description: `What each release is and where its files go on TMDB: the movie's or show's IMDb and TMDB ids, and each file's TMDB season and episode, anime cours and absolute numbering included. Send \`imdbId\` when you already know the title; otherwise DMM identifies the release by its name.\n\n\`releases\` lines up with the request and each \`files\` with its release's. \`complete: false\` means some releases ran past the call's time budget or needed an unreachable service: they come back \`"skipped": true\` with everything \`null\`; send them again later. \`rules\` names the placement rules the answer was made by: an answer kept from other rules is worth asking about again.\n\n**Limit:** ${per(sponsorPlace, 'calls')} per key, wherever your servers run.`,
				externalDocs: {
					url: `${REPO}/sponsor-api.md#place-releases-on-tmdb`,
					description: 'Placement rules',
				},
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['releases'],
						properties: {
							releases: {
								type: 'array',
								minItems: 1,
								maxItems: 100,
								description: 'At most 2,000 files across all releases',
								items: {
									type: 'object',
									required: ['name', 'files'],
									properties: {
										name: { type: 'string', maxLength: 1024 },
										hash: ref('InfoHash'),
										imdbId: {
											type: 'string',
											description: "tt…; an episode's id is read as its show",
										},
										files: {
											type: 'array',
											items: {
												type: 'object',
												required: ['path'],
												properties: {
													path: {
														type: 'string',
														maxLength: 1024,
														description: "The file's name",
													},
													folder: {
														type: 'string',
														maxLength: 1024,
														description:
															'The folder inside the release, "" at the top',
													},
												},
											},
										},
									},
								},
							},
						},
					},
					{
						releases: [
							{
								name: '[Erai-raws] Hibike Euphonium 3 - 01 [1080p][Multiple Subtitle][F15A9CDD].mkv',
								files: [
									{
										path: '[Erai-raws] Hibike Euphonium 3 - 01 [1080p][Multiple Subtitle][F15A9CDD].mkv',
										folder: '',
									},
								],
							},
						],
					}
				),
				responses: {
					'200': ok(
						'One placement per release, in order',
						{
							type: 'object',
							properties: {
								complete: { type: 'boolean' },
								rules: {
									type: 'string',
									description:
										'The placement rules this answer was made by; ask again about answers made by other rules',
								},
								releases: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											kind: { enum: ['movie', 'tv', null] },
											imdbId: { type: ['string', 'null'] },
											tmdbId: { type: ['integer', 'null'] },
											skipped: { type: 'boolean' },
											files: {
												type: 'array',
												items: {
													type: 'object',
													properties: {
														path: { type: 'string' },
														season: { type: ['integer', 'null'] },
														episode: { type: ['integer', 'null'] },
														episodeEnd: {
															type: ['integer', 'null'],
															description:
																'Last episode of a multi-episode file',
														},
														how: {
															enum: [
																'tmdb',
																'anime',
																'imdb',
																'tvdb',
																'dub',
																'group',
																'absolute',
																null,
															],
															description:
																'Which rule placed the file',
														},
														kind: {
															enum: ['movie'],
															description:
																"Only on a film inside a show's release, named on its own (with imdbId and tmdbId, the film's)",
														},
														imdbId: {
															type: 'string',
															description:
																"The film's IMDb id, with kind movie",
														},
														tmdbId: {
															type: 'integer',
															description:
																"The film's TMDB movie id, with kind movie",
														},
														tmdbEpisodeId: {
															type: ['integer', 'null'],
															description:
																"TMDB's id for the episode, which Plex's episode rows carry as tmdb://; null when unplaced or placed on IMDb's numbering",
														},
													},
												},
											},
										},
									},
								},
							},
						},
						{
							complete: true,
							rules: '2026-10-23.10',
							releases: [
								{
									kind: 'tv',
									imdbId: 'tt4384306',
									tmdbId: 62564,
									files: [
										{
											path: '[Erai-raws] Hibike Euphonium 3 - 01 [1080p][Multiple Subtitle][F15A9CDD].mkv',
											season: 3,
											episode: 1,
											episodeEnd: null,
											how: 'anime',
											tmdbEpisodeId: 4703269,
										},
									],
								},
							],
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/sponsor/wanted': {
			get: {
				tags: ['Sponsors'],
				operationId: 'wantedList',
				summary: 'Your wanted list',
				description: `The titles you added to your wanted list on DMM, for a tool that fetches them. A film leaves the list once it is acknowledged as fetched; a show stays so new episodes are fetched.\n\n\`seasons\` lists, per season wanted, the episodes aired so far as TMDB numbers them, with \`airing: true\` while more are to come. \`released\` is a film's first home release day (never a cinema date). \`titles\` is every title TMDB knows a film by. \`upgrade\` is on a fetched film whose fetcher asked for a better copy. Fields TMDB does not know are absent.\n\n**Limit:** ${per(sponsorWanted, 'calls')} per key, shared with acknowledging.`,
				externalDocs: {
					url: `${REPO}/sponsor-api.md#wanted-list`,
					description: 'Wanted list',
				},
				security: sponsorKey,
				parameters: [
					{
						name: 'bands',
						in: 'query',
						description:
							'For a fetcher that keeps a copy at several resolutions: `720p`, `1080p`, `2160p`, comma-separated. A film then stays until every band holds a copy, and carries `bands` in place of `upgrade`.',
						schema: { type: 'string' },
						example: '1080p,2160p',
					},
				],
				responses: {
					'200': ok(
						'Wanted titles',
						{
							type: 'object',
							properties: {
								items: {
									type: 'array',
									items: {
										type: 'object',
										required: ['id', 'kind', 'title', 'imdb'],
										properties: {
											id: { type: 'string' },
											kind: { enum: ['movie', 'show'] },
											title: { type: 'string' },
											imdb: { type: 'string' },
											year: { type: 'integer' },
											tmdb: { type: 'integer' },
											tvdb: { type: 'integer' },
											titles: { type: 'array', items: { type: 'string' } },
											released: { type: 'string', format: 'date' },
											runtime: { type: 'integer', description: 'Minutes' },
											seasons: {
												type: 'array',
												items: {
													type: 'object',
													properties: {
														season: { type: 'integer' },
														episodes: {
															type: 'array',
															items: { type: 'integer' },
														},
														airing: { type: 'boolean' },
														aired: { type: 'string', format: 'date' },
													},
												},
											},
											upgrade: {
												type: 'object',
												properties: {
													grab: { type: 'string' },
													resolution: { type: 'string' },
													to: { type: 'string' },
												},
											},
											bands: { type: 'object' },
										},
									},
								},
							},
						},
						{
							items: [
								{
									id: '0b7c2f8e-…',
									kind: 'movie',
									title: 'The Matrix',
									imdb: 'tt0133093',
									year: 1999,
									tmdb: 603,
									titles: ['The Matrix', 'Matrix'],
									released: '1999-09-21',
									runtime: 136,
								},
								{
									id: '5d1e…',
									kind: 'show',
									title: '3rd Rock from the Sun',
									imdb: 'tt0115082',
									year: 1996,
									tmdb: 155,
									seasons: [{ season: 1, episodes: [1, 2, 3] }],
								},
							],
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/sponsor/wanted/complete': {
			post: {
				tags: ['Sponsors'],
				operationId: 'wantedComplete',
				summary: 'Acknowledge a fetched title',
				description: `Says a wanted title was fetched. Only \`id\` is required. Without \`upgrade_to\` a film leaves the list; with it the film stays, carrying \`upgrade\`, until an acknowledgement without one. Each acknowledgement replaces the last one's fields, so repeating one is harmless. \`band\` records the copy against that resolution only, for a fetcher that asked for \`?bands=\`.\n\n**Limit:** ${per(sponsorWanted, 'calls')} per key, shared with the list.`,
				externalDocs: {
					url: `${REPO}/sponsor-api.md#wanted-list`,
					description: 'Wanted list',
				},
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['id'],
						properties: {
							id: { type: 'string' },
							release: { type: 'string', maxLength: 512 },
							grab: {
								type: 'string',
								maxLength: 64,
								description: "The fetcher's id of it: an info hash or NZB id",
							},
							resolution: { enum: ['', '480p', '720p', '1080p', '2160p'] },
							upgrade_to: {
								enum: ['720p', '1080p', '2160p'],
								description: 'Needs `resolution`',
							},
							band: { enum: ['720p', '1080p', '2160p'] },
							torrent: { type: 'boolean' },
						},
					},
					{
						id: '0b7c2f8e-…',
						grab: HASH,
						release: 'The.Matrix.1999.1080p.BluRay.x264-GRP',
						resolution: '1080p',
						torrent: true,
						upgrade_to: '2160p',
					}
				),
				responses: {
					'200': ok('Recorded', { type: 'object', properties: { ok: { const: true } } }),
					'404': {
						description: 'The item is no longer on the list',
						content: json(ref('Error'), { error: 'Not on this wanted list' }),
					},
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/zurg/search-torrents': {
			post: {
				tags: ['Sponsors'],
				operationId: 'searchCachedReleases',
				summary: 'Cached releases for a title',
				description: `Real-Debrid-cached releases for an IMDb id, biggest first. A show answers per season. Each release carries \`parsed\`: resolution, source, codecs, HDR, group and episode numbers read from its name.\n\n**Limit:** ${per(zurg, 'calls')}, shared with the other /api/zurg endpoints.`,
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['imdbId', 'mediaType'],
						properties: {
							imdbId: { type: 'string', pattern: '^tt\\d+$' },
							mediaType: { enum: ['movie', 'tv'] },
							quality: { enum: ['4k', '1080p', '720p', 'best'], default: 'best' },
							maxSize: { type: 'number', description: 'GB; 0 or absent for no cap' },
							limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
						},
					},
					{ imdbId: 'tt0133093', mediaType: 'movie', quality: '1080p', limit: 5 }
				),
				responses: {
					'200': ok('Releases', {
						type: 'object',
						properties: {
							mediaType: { enum: ['movie', 'tv'] },
							count: { type: 'integer' },
							results: {
								type: 'array',
								items: ref('Release'),
								description: 'Movies',
							},
							seasonCount: { type: 'integer', description: 'Shows' },
							seasons: {
								type: 'object',
								description:
									'Shows: season number to its releases, empty seasons left out',
								additionalProperties: { type: 'array', items: ref('Release') },
							},
						},
					}),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/zurg/show-info': {
			post: {
				tags: ['Sponsors'],
				operationId: 'showInfo',
				summary: 'Seasons of a show',
				description: `Season count and whether there are specials, by IMDb id.\n\n**Limit:** ${per(zurg, 'calls')}, shared with the other /api/zurg endpoints.`,
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['imdbId'],
						properties: { imdbId: { type: 'string', pattern: '^tt\\d+$' } },
					},
					{ imdbId: 'tt0279600' }
				),
				responses: {
					'200': ok(
						'Show',
						{
							type: 'object',
							properties: {
								title: { type: 'string' },
								imdbId: { type: 'string' },
								seasonCount: { type: 'integer' },
								hasSpecials: { type: 'boolean' },
							},
						},
						{
							title: 'Smallville',
							imdbId: 'tt0279600',
							seasonCount: 10,
							hasSpecials: true,
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/zurg/resolve-tmdb': {
			post: {
				tags: ['Sponsors'],
				operationId: 'resolveTmdb',
				summary: 'IMDb id for a TMDB id',
				description: `**Limit:** ${per(zurg, 'calls')}, shared with the other /api/zurg endpoints.`,
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['tmdbId', 'mediaType'],
						properties: {
							tmdbId: { type: ['integer', 'string'] },
							mediaType: { enum: ['movie', 'tv'] },
						},
					},
					{ tmdbId: 603, mediaType: 'movie' }
				),
				responses: {
					'200': ok(
						'Resolved',
						{
							type: 'object',
							properties: {
								imdbId: { type: ['string', 'null'] },
								tmdbId: { type: 'string' },
								mediaType: { enum: ['movie', 'tv'] },
							},
						},
						{ imdbId: 'tt0133093', tmdbId: '603', mediaType: 'movie' }
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/metadata/{id}': {
			get: {
				tags: ['Metadata'],
				operationId: 'getMetadata',
				summary: 'Everything known about a title',
				description: `Each metadata source's own answer (TMDB, Trakt, mdblist, Cinemeta, OMDb, TVmaze) under \`sources\`, in that source's own shape, beside DMM's merge of them in \`merged\`.\n\n**Limit:** ${per(metadata, 'calls')} per key, shared with search.`,
				security: sponsorKey,
				parameters: [
					{
						name: 'id',
						in: 'path',
						required: true,
						description: '`imdb:tt…`, `tmdb:movie:N` or `tmdb:tv:N`',
						schema: { type: 'string' },
						examples: {
							imdb: { value: 'imdb:tt0852863' },
							show: { value: 'tmdb:tv:1877' },
							movie: { value: 'tmdb:movie:603' },
						},
					},
					{
						name: 'season',
						in: 'query',
						description: "Add `sources.tmdbSeason`, that season's episode list",
						schema: { type: 'integer', minimum: 0, maximum: 9999 },
					},
					{
						name: 'episode',
						in: 'query',
						description: 'With `season`: add `sources.tmdbEpisode`',
						schema: { type: 'integer', minimum: 0, maximum: 9999 },
					},
					{
						name: 'sources',
						in: 'query',
						description: "Answer TMDB's records alone",
						schema: { enum: ['tmdb'] },
					},
				],
				responses: {
					'200': ok(
						'The title',
						{
							type: 'object',
							properties: {
								ids: {
									type: 'object',
									description: 'Every id DMM knows the title by',
									properties: {
										imdb: { type: 'string' },
										tmdb: { type: 'integer' },
										tvdb: { type: 'integer' },
									},
								},
								type: { enum: ['movie', 'show', 'episode'] },
								merged: { type: ['object', 'null'] },
								sources: {
									type: 'object',
									description: "Each source's answer, `null` where it failed",
									additionalProperties: true,
								},
							},
						},
						{
							ids: { imdb: 'tt0220880', tmdb: 2085, tvdb: 77435 },
							type: 'show',
							merged: null,
							sources: {
								tmdb: { id: 2085, name: 'Courage the Cowardly Dog' },
								tmdbSeason: {
									season_number: 2,
									episodes: [
										{ episode_number: 1, name: 'The Magic Tree of Nowhere' },
									],
								},
							},
						}
					),
					...errors('400', '401'),
					'404': {
						description: 'No source knows the title',
						content: json(ref('Error')),
					},
					...errors('429'),
				},
			},
		},
		'/api/metadata/search': {
			get: {
				tags: ['Metadata'],
				operationId: 'searchMetadata',
				summary: 'Find a title by name',
				description: `Candidates for a title by name. \`sources.tmdb\` is TMDB's \`/search/movie\` or \`/search/tv\` answer; read a candidate through \`/api/metadata/tmdb:{movie|tv}:N\`.\n\n**Limit:** ${per(metadata, 'calls')} per key, shared with \`/api/metadata/{id}\`.`,
				security: sponsorKey,
				parameters: [
					{
						name: 'query',
						in: 'query',
						required: true,
						schema: { type: 'string', maxLength: 200 },
						example: 'Smallville',
					},
					{
						name: 'type',
						in: 'query',
						required: true,
						schema: { enum: ['movie', 'show'] },
					},
					{
						name: 'year',
						in: 'query',
						description: "A movie's release year or a show's first air year",
						schema: { type: 'integer', minimum: 1000, maximum: 9999 },
					},
				],
				responses: {
					'200': ok(
						'Candidates',
						{
							type: 'object',
							properties: { sources: { type: 'object', additionalProperties: true } },
						},
						{
							sources: {
								tmdb: { page: 1, results: [{ id: 4604, name: 'Smallville' }] },
							},
						}
					),
					...errors('400', '401', '429'),
				},
			},
		},
		'/api/torznab/api': {
			get: {
				tags: ['Indexers and plugins'],
				operationId: 'torznab',
				summary: 'Torznab indexer',
				description: `DMM's torrent library as a Torznab indexer for Prowlarr, Sonarr and Radarr. Feeds such as \`/api/torznab/rd/cached/api\` (only what Real-Debrid already holds) sit under the same path. \`t=caps\` needs no key. Errors are Torznab \`<error/>\` documents, mostly with HTTP 200.\n\n**Limit:** ${per(torznabSearch, 'pages')} per key.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/torznab',
					description: 'Torrent indexer setup',
				},
				security: sponsorQuery,
				parameters: [
					{
						name: 't',
						in: 'query',
						required: true,
						schema: { enum: ['caps', 'search', 'tvsearch', 'movie'] },
					},
					{ name: 'q', in: 'query', schema: { type: 'string' } },
					{ name: 'imdbid', in: 'query', schema: { type: 'string' } },
					{ name: 'tvdbid', in: 'query', schema: { type: 'string' } },
					{ name: 'season', in: 'query', schema: { type: 'string' } },
					{ name: 'ep', in: 'query', schema: { type: 'string' } },
					{ name: 'cat', in: 'query', schema: { type: 'string' } },
					{ name: 'offset', in: 'query', schema: { type: 'integer' } },
					{ name: 'limit', in: 'query', schema: { type: 'integer' } },
				],
				responses: {
					'200': {
						description: 'Torznab RSS, caps or error XML',
						content: { 'application/rss+xml': {}, 'application/xml': {} },
					},
				},
			},
		},
		'/api/newznab/api': {
			get: {
				tags: ['Indexers and plugins'],
				operationId: 'newznab',
				summary: 'Newznab indexer',
				description: `Usenet search as a Newznab indexer for Prowlarr, Sonarr and Radarr. \`t=caps\` needs no key; \`t=get\` downloads the NZB a search item names. Errors are Newznab \`<error/>\` documents, mostly with HTTP 200.\n\n**Limits:** ${per(newznabSearch, 'searches')}, ${per(newznabGrab, 'grabs')}, ${per(newznabGrabDay, 'grabs')}.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/newznab',
					description: 'Usenet indexer setup',
				},
				security: sponsorQuery,
				parameters: [
					{
						name: 't',
						in: 'query',
						required: true,
						schema: { enum: ['caps', 'search', 'tvsearch', 'movie', 'get'] },
					},
					{ name: 'q', in: 'query', schema: { type: 'string' } },
					{ name: 'imdbid', in: 'query', schema: { type: 'string' } },
					{ name: 'tvdbid', in: 'query', schema: { type: 'string' } },
					{ name: 'season', in: 'query', schema: { type: 'string' } },
					{ name: 'ep', in: 'query', schema: { type: 'string' } },
					{ name: 'cat', in: 'query', schema: { type: 'string' } },
					{ name: 'offset', in: 'query', schema: { type: 'integer' } },
					{ name: 'limit', in: 'query', schema: { type: 'integer' } },
					{
						name: 'id',
						in: 'query',
						description: 'With `t=get`',
						schema: { type: 'string' },
					},
				],
				responses: {
					'200': {
						description: 'Newznab RSS, caps, NZB or error XML',
						content: {
							'application/rss+xml': {},
							'application/xml': {},
							'application/x-nzb': {},
						},
					},
				},
			},
		},
		'/api/plugins/manifest.json': {
			get: {
				tags: ['Indexers and plugins'],
				operationId: 'jellyfinManifest',
				summary: 'Jellyfin plugin repository',
				description: `The repository URL for the zurg Jellyfin plugins: paste it into Dashboard → Plugins → Repositories. Its download URLs carry your key.\n\n**Limit:** ${perAddress}.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/jellyfin',
					description: 'Jellyfin plugins',
				},
				security: sponsorQuery,
				responses: {
					'200': ok('A Jellyfin plugin manifest', { type: 'array' }),
					...errors('401'),
				},
			},
		},
		'/api/emby-plugins/{file}': {
			get: {
				tags: ['Indexers and plugins'],
				operationId: 'embyPlugins',
				summary: 'Emby plugin downloads',
				description: `\`catalog.json\` lists each published plugin's version, size and sha256; \`Emby.Plugin.RdZurg.dll\` downloads the latest build and \`Emby.Plugin.RdZurg.dll.sha256\` its digest.\n\n**Limit:** ${perAddress}.`,
				externalDocs: {
					url: 'https://debridmediamanager.com/emby',
					description: 'Emby plugins',
				},
				security: [...sponsorKey, ...sponsorQuery],
				parameters: [
					{
						name: 'file',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						examples: {
							catalog: { value: 'catalog.json' },
							dll: { value: 'Emby.Plugin.RdZurg.dll' },
						},
					},
				],
				responses: {
					'200': {
						description: 'The catalog, a DLL or its digest',
						content: {
							'application/json': {},
							'application/octet-stream': {},
							'text/plain': {},
						},
					},
					...errors('401'),
				},
			},
		},
	},
	components: {
		securitySchemes: {
			dmmApiKey: {
				type: 'apiKey',
				in: 'header',
				name: 'x-api-key',
				description: `Your 64-character DMM API key from [gatekeeper](${GATEKEEPER_URL})`,
			},
			apikeyQuery: {
				type: 'apiKey',
				in: 'query',
				name: 'apikey',
				description: 'Your DMM API key, where the client can only send a query string',
			},
		},
		schemas: {
			Error: {
				type: 'object',
				required: ['error'],
				properties: { error: { type: 'string' } },
			},
			InfoHash: {
				type: 'string',
				pattern: '^[a-fA-F0-9]{40}$',
				description: '40-character BitTorrent info hash',
				example: HASH,
			},
			Identification: {
				type: 'object',
				properties: {
					imdbId: { type: 'string' },
					title: { type: 'string' },
					year: { type: ['integer', 'null'] },
					kind: { enum: ['movie', 'tv'] },
				},
			},
			Release: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					fileSize: { type: 'number', description: 'MB' },
					hash: { $ref: '#/components/schemas/InfoHash' },
					parsed: ref('ReleaseFields'),
				},
			},
			ReleaseFields: {
				type: 'object',
				description:
					"What the release's name says, read from the name alone. `null` where the name does not say. Languages are left out: a name rarely states them.",
				properties: {
					resolution: { type: ['string', 'null'], examples: ['2160p', '1080p', '720p'] },
					source: {
						type: ['string', 'null'],
						examples: ['bluray', 'webdl', 'webrip', 'tv', 'dvd'],
					},
					remux: { type: 'boolean' },
					videoCodec: { type: ['string', 'null'], examples: ['x265', 'x264', 'h265'] },
					hdr: { enum: ['DV', 'HDR', null], description: 'Dolby Vision wins over HDR' },
					audioCodec: {
						type: ['string', 'null'],
						examples: ['Dolby TrueHD', 'Dolby Digital Plus', 'DTS-HD MA'],
					},
					audioChannels: { type: ['string', 'null'], examples: ['7.1', '5.1', '2.0'] },
					group: { type: ['string', 'null'] },
					proper: { type: 'boolean', description: 'PROPER or REPACK' },
					seasons: { type: 'array', items: { type: 'integer' } },
					episodes: { type: 'array', items: { type: 'integer' } },
					complete: { type: 'boolean', description: 'A whole season or several' },
				},
				example: {
					resolution: '2160p',
					source: 'bluray',
					remux: true,
					videoCodec: 'x265',
					hdr: 'HDR',
					audioCodec: 'Dolby TrueHD',
					audioChannels: '7.1',
					group: 'FGT',
					proper: false,
					seasons: [],
					episodes: [],
					complete: false,
				},
			},
		},
		responses: {
			'400': {
				description: 'A malformed request; `error` says what is expected',
				content: json(ref('Error')),
			},
			'401': {
				description: 'Missing, unknown or revoked key, or a lapsed sponsorship',
				content: json(ref('Error'), { error: 'Sponsorship is no longer active' }),
			},
			'429': {
				description: 'Rate limit spent; `Retry-After` gives the seconds',
				headers: { 'Retry-After': { schema: { type: 'integer' } } },
				content: json(ref('Error')),
			},
		},
	},
};
