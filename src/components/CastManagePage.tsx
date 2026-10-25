import { CastLoginRequired } from '@/components/CastLoginRequired';
import Poster from '@/components/poster';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { toasterPosition } from '@/utils/toastOptions';
import { Eye, Trash2 } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import ptt from 'parse-torrent-title';
import { ComponentProps, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Toaster, toast } from 'react-hot-toast';

interface CastedLink {
	imdbId: string;
	url: string;
	hash: string;
	size: number;
	updatedAt: Date;
}

interface GroupedLinks {
	[imdbId: string]: CastedLink[];
}

interface EpisodeInfo {
	season: number;
	episode: number;
}

interface MediaMetadata {
	title: string;
	type: 'movie' | 'show';
}

// Tailwind classes stay complete literals in each provider's config so the
// build can see them.
export interface CastManageConfig {
	name: string;
	// Shown in the heading and back link; Real-Debrid's pages leave it out.
	label: string;
	loginProvider: ComponentProps<typeof CastLoginRequired>['provider'];
	apiPrefix: string;
	castPath: string;
	logTag: string;
	// Real-Debrid's original endpoints: GET with a Bearer header, and a POST
	// delete carrying `token`. Every other provider's links endpoint is
	// POST-only and reads the key from the body, so it never lands in an
	// access log, and deletes with DELETE carrying `apiKey`.
	legacyRdApi?: boolean;
	// TorBox's links endpoint takes the key as a Bearer header too.
	bearerLinks?: boolean;
	theme: {
		checkbox: string;
		castButton: string;
		episode: string;
	};
}

export function CastManagePage({
	config,
	apiKey: rdKey,
	apiKeyLoading: rdKeyLoading = false,
}: {
	config: CastManageConfig;
	apiKey: string | null | undefined;
	apiKeyLoading?: boolean;
}) {
	const { theme } = config;
	const titleText = `DMM Cast${config.label ? ` ${config.label}` : ''} - Manage Casted Links`;
	const [groupedLinks, setGroupedLinks] = useState<GroupedLinks>({});
	const [loading, setLoading] = useState(true);
	const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
	const [mediaInfo, setMediaInfo] = useState<Record<string, MediaMetadata>>({});

	const getEpisodeInfo = (imdbId: string): EpisodeInfo | null => {
		const parts = imdbId.split(':');
		if (parts.length === 3) {
			return {
				season: parseInt(parts[1]),
				episode: parseInt(parts[2]),
			};
		}
		return null;
	};

	useEffect(() => {
		const fetchLinks = async () => {
			if (!rdKey) {
				setLoading(false);
				return;
			}

			try {
				const response = await fetch(
					`/api/${config.apiPrefix}/links`,
					config.legacyRdApi || config.bearerLinks
						? { headers: { Authorization: `Bearer ${rdKey}` } }
						: {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ apiKey: rdKey }),
							}
				);
				if (!response.ok) throw new Error('Failed to fetch links');
				const data = await response.json();
				const links = config.legacyRdApi ? data : data.links || [];

				// Group links by imdbId
				const grouped = links.reduce((acc: GroupedLinks, link: CastedLink) => {
					const baseImdbId = link.imdbId.split(':')[0]; // Handle TV show episodes
					if (!acc[baseImdbId]) {
						acc[baseImdbId] = [];
					}
					acc[baseImdbId].push(link);
					return acc;
				}, {});

				// Sort links within each group by season and episode numbers
				Object.keys(grouped).forEach((imdbId) => {
					grouped[imdbId].sort((a: CastedLink, b: CastedLink) => {
						const aEpisode = getEpisodeInfo(a.imdbId);
						const bEpisode = getEpisodeInfo(b.imdbId);
						if (!aEpisode && !bEpisode) return 0;
						if (!aEpisode) return -1;
						if (!bEpisode) return 1;
						return (
							aEpisode.season * 1000 +
							aEpisode.episode -
							(bEpisode.season * 1000 + bEpisode.episode)
						);
					});
				});

				setGroupedLinks(grouped);
			} catch (error) {
				console.error(error);
				toast.error('Failed to fetch casted links.');
			} finally {
				setLoading(false);
			}
		};

		fetchLinks();
	}, [rdKey, config]);

	useEffect(() => {
		const imdbIdsToFetch = Object.keys(groupedLinks).filter((imdbId) => !mediaInfo[imdbId]);
		if (imdbIdsToFetch.length === 0) return;

		let active = true;

		const loadMetadata = async () => {
			const results = await Promise.all(
				imdbIdsToFetch.map(async (imdbId) => {
					const links = groupedLinks[imdbId] ?? [];
					const isShow = links.some((link) => link.imdbId.split(':').length === 3);
					const endpoint = isShow ? '/api/info/show' : '/api/info/movie';
					const mediaType: MediaMetadata['type'] = isShow ? 'show' : 'movie';
					try {
						console.info(
							`[${config.logTag}] Fetching metadata for ${imdbId} using ${endpoint}`
						);
						const response = await fetch(`${endpoint}?imdbid=${imdbId}`);
						if (!response.ok) {
							throw new Error(
								`Metadata request failed with status ${response.status}`
							);
						}
						const data = await response.json();
						const title =
							typeof data.title === 'string' && data.title.trim()
								? data.title.trim()
								: imdbId;
						return {
							imdbId,
							info: {
								title,
								type: mediaType,
							},
						};
					} catch (error) {
						console.error(
							`[${config.logTag}] Metadata lookup failed for ${imdbId}:`,
							error
						);
						return {
							imdbId,
							info: {
								title: imdbId,
								type: mediaType,
							},
						};
					}
				})
			);

			if (!active) return;

			setMediaInfo((prev) => {
				const updated = { ...prev };
				for (const result of results) {
					updated[result.imdbId] = result.info;
				}
				return updated;
			});
		};

		void loadMetadata();

		return () => {
			active = false;
		};
	}, [groupedLinks, mediaInfo, config.logTag]);

	const getStremioUrl = (link: CastedLink): string => {
		const baseImdbId = link.imdbId.split(':')[0];
		const filename = link.url.split('/').pop() || '';
		const info = ptt.parse(filename);
		const seasonNumber = info.season;
		const episodeNumber = info.episode;

		if (seasonNumber !== undefined && episodeNumber !== undefined) {
			return getStremioDetailUrl(baseImdbId, {
				season: seasonNumber,
				episode: episodeNumber,
			});
		}
		return getStremioDetailUrl(baseImdbId);
	};

	const deleteLink = (link: CastedLink) =>
		fetch(`/api/${config.apiPrefix}/deletelink`, {
			method: config.legacyRdApi ? 'POST' : 'DELETE',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				...(config.legacyRdApi ? { token: rdKey } : { apiKey: rdKey }),
				imdbId: link.imdbId,
				hash: link.hash,
			}),
		});

	const handleDelete = async (link: CastedLink) => {
		try {
			if (!rdKey) return;

			const response = await deleteLink(link);

			if (!response.ok) throw new Error('Failed to delete link');

			// Update state after successful deletion
			const baseImdbId = link.imdbId.split(':')[0];
			let removedImdbId: string | null = null;
			flushSync(() => {
				setGroupedLinks((prev) => {
					const newGrouped = { ...prev };
					newGrouped[baseImdbId] = newGrouped[baseImdbId].filter(
						(l) => l.url !== link.url
					);
					if (newGrouped[baseImdbId].length === 0) {
						delete newGrouped[baseImdbId];
						removedImdbId = baseImdbId;
					}
					return newGrouped;
				});
			});

			if (removedImdbId) {
				const imdbIdToRemove = removedImdbId;
				setMediaInfo((prev) => {
					if (!(imdbIdToRemove in prev)) {
						return prev;
					}
					const { [imdbIdToRemove]: _removed, ...rest } = prev;
					return rest;
				});
			}

			toast.success('Link deleted from Stremio list.');
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete Stremio link.');
		}
	};

	const handleDeleteSelected = async () => {
		if (selectedLinks.size === 0) return;

		try {
			const deletePromises = Array.from(selectedLinks).map(async (url) => {
				let link: CastedLink | null = null;
				for (const links of Object.values(groupedLinks)) {
					link = links.find((l) => l.url === url) || null;
					if (link) break;
				}
				if (!link) return;

				const response = await deleteLink(link);

				if (!response.ok) throw new Error('Failed to delete link');
				return url;
			});

			const deletedUrls = (await Promise.all(deletePromises)).filter(
				(url): url is string => typeof url === 'string'
			);

			// Update state after successful deletions
			const removedImdbIds: string[] = [];
			flushSync(() => {
				setGroupedLinks((prev) => {
					const newGrouped = { ...prev };
					Object.keys(newGrouped).forEach((imdbId) => {
						newGrouped[imdbId] = newGrouped[imdbId].filter(
							(link) => !deletedUrls.includes(link.url)
						);
						if (newGrouped[imdbId].length === 0) {
							delete newGrouped[imdbId];
							removedImdbIds.push(imdbId);
						}
					});
					return newGrouped;
				});
			});

			if (removedImdbIds.length > 0) {
				setMediaInfo((prev) => {
					const updated = { ...prev };
					for (const imdbId of removedImdbIds) {
						delete updated[imdbId];
					}
					return updated;
				});
			}

			setSelectedLinks(new Set());
			toast.success('Deleted selected Stremio links.');
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete selected Stremio links.');
		}
	};

	const toggleLinkSelection = (url: string) => {
		setSelectedLinks((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(url)) {
				newSet.delete(url);
			} else {
				newSet.add(url);
			}
			return newSet;
		});
	};

	const toggleGroupSelection = (imdbId: string) => {
		const links = groupedLinks[imdbId];
		const urls = links.map((link) => link.url);
		const allSelected = urls.every((url) => selectedLinks.has(url));

		setSelectedLinks((prev) => {
			const newSet = new Set(prev);
			if (allSelected) {
				urls.forEach((url) => newSet.delete(url));
			} else {
				urls.forEach((url) => newSet.add(url));
			}
			return newSet;
		});
	};

	const formatSize = (size: number) => {
		const gb = size / 1024;
		return `${gb.toFixed(2)} GB`;
	};

	const getFilename = (url: string) => {
		try {
			return decodeURIComponent(url.split('/').pop() || '');
		} catch (error) {
			return 'Unknown file';
		}
	};

	const deriveTitleFromLinks = (links: CastedLink[]): string | null => {
		for (const link of links) {
			const filename = getFilename(link.url);
			if (!filename || filename === 'Unknown file') {
				continue;
			}
			const parsed = ptt.parse(filename);
			const candidate =
				typeof parsed.title === 'string' ? parsed.title.replace(/\./g, ' ').trim() : '';
			if (candidate) {
				return candidate;
			}
		}
		return null;
	};

	const formatEpisodeLabel = (imdbId: string) => {
		const episodeInfo = getEpisodeInfo(imdbId);
		if (episodeInfo) {
			return `S${episodeInfo.season.toString().padStart(2, '0')}E${episodeInfo.episode.toString().padStart(2, '0')}`;
		}
		return null;
	};

	if (!rdKey) {
		if (rdKeyLoading) {
			return (
				<div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
					<h1 className="text-center text-xl text-white">
						Debrid Media Manager is loading...
					</h1>
				</div>
			);
		}
		return (
			<CastLoginRequired
				provider={config.loginProvider}
				name={config.name}
				returnPath={`${config.castPath}/manage`}
				title={`DMM Cast for ${config.name} - Manage`}
			/>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>{titleText}</title>
			</Head>
			<Toaster position={toasterPosition()} />

			{selectedLinks.size > 0 && (
				<div className="fixed top-0 right-0 left-0 z-50 flex justify-center bg-gray-900/95 p-4 backdrop-blur">
					<button
						onClick={handleDeleteSelected}
						className="haptic-sm rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
					>
						Delete Selected ({selectedLinks.size})
					</button>
				</div>
			)}

			<h1 className="mb-4 text-xl font-bold text-white">Casted links</h1>

			{loading ? (
				<p className="text-white">Loading...</p>
			) : Object.keys(groupedLinks).length === 0 ? (
				<p className="text-white">No casted links found</p>
			) : (
				<div className="grid w-full max-w-6xl items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
					{Object.entries(groupedLinks).map(([imdbId, links]) => {
						const allSelected = links.every((link) => selectedLinks.has(link.url));
						const someSelected = links.some((link) => selectedLinks.has(link.url));
						const metadata = mediaInfo[imdbId];
						const derivedTitle = deriveTitleFromLinks(links);
						const displayTitle = metadata?.title ?? derivedTitle ?? imdbId;
						const isShowGroup =
							metadata?.type === 'show' ||
							links.some((link) => link.imdbId.split(':').length === 3);
						return (
							<div key={imdbId} className="rounded-lg bg-gray-800 p-3">
								<div className="mb-2 flex items-center gap-3">
									{/* The thumbnail and title stay the card's select-all toggle */}
									<button
										type="button"
										onClick={() => toggleGroupSelection(imdbId)}
										aria-pressed={allSelected}
										aria-label={`Toggle selection for ${isShowGroup ? 'show' : 'movie'} ${displayTitle}`}
										className="group flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-hidden"
									>
										<span className="block w-14 shrink-0">
											<Poster imdbId={imdbId} title={displayTitle} />
										</span>
										<span className="min-w-0 text-base font-semibold text-gray-100 group-hover:text-white">
											{displayTitle}
										</span>
									</button>
									<Link
										href={`/x/${imdbId}`}
										className={`haptic-sm shrink-0 rounded px-3 py-1 text-sm text-white ${theme.castButton}`}
										title={`Cast other torrents for ${displayTitle}`}
										aria-label={`Cast other torrents for ${displayTitle}`}
									>
										Cast other torrents
									</Link>
								</div>
								{links.length > 1 && (
									<label className="mb-2 flex w-max cursor-pointer items-center gap-2">
										<input
											type="checkbox"
											checked={allSelected}
											ref={(input) => {
												if (input) {
													input.indeterminate =
														someSelected && !allSelected;
												}
											}}
											onChange={() => toggleGroupSelection(imdbId)}
											className={`h-4 w-4 rounded border-gray-300 bg-gray-700 ${theme.checkbox}`}
										/>
										<span className="text-sm font-medium text-white">
											Select All
										</span>
									</label>
								)}
								<div className="sibling-space-y-2 max-h-[300px] overflow-y-auto">
									{links.map((link) => {
										const episodeLabel = formatEpisodeLabel(link.imdbId);
										return (
											<div
												key={link.url}
												className="flex items-center justify-between rounded bg-gray-700 p-2"
											>
												<div className="mr-2 flex min-w-0 flex-1 items-center gap-2">
													<input
														type="checkbox"
														checked={selectedLinks.has(link.url)}
														onChange={() =>
															toggleLinkSelection(link.url)
														}
														className={`h-4 w-4 rounded border-gray-300 bg-gray-600 ${theme.checkbox}`}
													/>
													<div className="flex min-w-0 flex-1 flex-col">
														{episodeLabel && (
															<span
																className={`text-sm font-medium ${theme.episode}`}
															>
																{episodeLabel} ·{' '}
																{formatSize(link.size)}
															</span>
														)}
														<span className="text-sm [overflow-wrap:anywhere] text-gray-300">
															{getFilename(link.url)}
															{!episodeLabel && (
																<span className="text-xs whitespace-nowrap text-gray-400">
																	{' '}
																	· {formatSize(link.size)}
																</span>
															)}
														</span>
													</div>
												</div>
												<div className="flex shrink-0 gap-2">
													<a
														href={getStremioUrl(link)}
														aria-label={`Open ${episodeLabel ?? displayTitle} in Stremio`}
														title="Open in Stremio"
														className="haptic-sm rounded bg-cyan-700 px-3 py-1 text-sm text-white hover:bg-cyan-800"
													>
														<Eye className="h-4 w-4" />
													</a>
													<button
														onClick={() => handleDelete(link)}
														aria-label={`Delete casted link ${getFilename(link.url)}`}
														title="Delete casted link"
														className="haptic-sm rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
													>
														<Trash2 className="h-4 w-4" />
													</button>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<Link
				href={config.castPath}
				className="haptic-sm mt-6 rounded border-2 border-cyan-500 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-800/50"
			>
				Back to Stremio{config.label ? ` ${config.label}` : ''}
			</Link>
		</div>
	);
}
