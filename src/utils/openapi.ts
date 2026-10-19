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
	sponsorPlace,
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
	tags: [
		{ name: 'Open', description: 'No sponsorship needed.' },
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
				description: `Which hashes DMM users have found cached on Real-Debrid (\`rd\`) or AllDebrid (\`ad\`), with their files. \`imdbId\` limits the answer to that title. A hash missing from \`available\` has not been seen cached, which does not mean it is not.\n\n**Limit:** ${per(sponsorAvailability, 'calls')}.`,
				security: sponsorKey,
				requestBody: body(
					{
						type: 'object',
						required: ['service', 'hashes'],
						properties: {
							service: { enum: ['rd', 'ad'] },
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
				description: `The ffprobe output zurg users have already shared for each release hash: streams, codecs, languages, HDR and duration per file, so your tools need not download anything to read them. \`MediaInfo\` is ffprobe's own JSON (\`-show_format -show_streams\`). A probe describes the file at \`path\` with that exact size, so match on both. Hashes nobody has probed are left out, and so are files inside archives and Usenet releases.\n\n**Limit:** ${per(sponsorMediaInfo, 'calls')}.`,
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
		'/api/sponsor/place': {
			post: {
				tags: ['Sponsors'],
				operationId: 'placeReleases',
				summary: 'Place releases on TMDB',
				description: `What each release is and where its files go on TMDB: the movie's or show's IMDb and TMDB ids, and each file's TMDB season and episode, anime cours and absolute numbering included. Send \`imdbId\` when you already know the title; otherwise DMM identifies the release by its name.\n\n\`releases\` lines up with the request and each \`files\` with its release's. \`complete: false\` means some releases ran past the call's time budget or needed an unreachable service: they come back \`"skipped": true\` with everything \`null\`; send them again later.\n\n**Limit:** ${per(sponsorPlace, 'calls')} per key, wherever your servers run.`,
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
																'absolute',
																null,
															],
															description:
																'Which rule placed the file',
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
		'/api/zurg/search-torrents': {
			post: {
				tags: ['Sponsors'],
				operationId: 'searchCachedReleases',
				summary: 'Cached releases for a title',
				description: `Real-Debrid-cached releases for an IMDb id, biggest first. A show answers per season.\n\n**Limit:** ${per(zurg, 'calls')}, shared with the other /api/zurg endpoints.`,
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
