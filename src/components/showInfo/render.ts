import { TorBoxFile } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import { renderButton, renderFileRow } from './components';
import { ApiTorrentFile, MagnetLink } from './types';
import { getEpisodeInfo } from './utils';

export const renderTorrentInfo = (
	info: any,
	isRd: boolean,
	// The API key of whichever service owns this torrent — RD's when `isRd`,
	// AllDebrid's otherwise. Both branches use it to authenticate the watch link.
	serviceKey: string,
	app?: string,
	imdbId?: string,
	mediaType?: 'movie' | 'tv'
) => {
	if (isRd) {
		const rdInfo = info;
		const showCheckbox = !rdInfo.fake;
		// Map each selected file to its link before sorting
		let linkIndex = 0;
		const fileLinkMap = new Map<number, string>();
		for (const file of rdInfo.files) {
			if (file.selected === 1) {
				fileLinkMap.set(file.id, rdInfo.links[linkIndex++]);
			}
		}
		rdInfo.files.sort((a: ApiTorrentFile, b: ApiTorrentFile) => a.path.localeCompare(b.path));
		const filesList = rdInfo.files.map((file: ApiTorrentFile) => {
			const actions = [];
			if (file.selected === 1) {
				const fileLink = fileLinkMap.get(file.id)!;
				if (info.status === 'downloaded' && !rdInfo.fake) {
					actions.push(
						renderButton('download', {
							link: 'https://real-debrid.com/downloader',
							linkParam: { name: 'links', value: fileLink },
							text: 'DL',
						})
					);
				}
				if (info.status === 'downloaded' && app) {
					// AllDebrid and TorBox rows have always gated on this; Real-Debrid
					// did not, so it offered "Watch" on .nfo and .srt files too.
					if (serviceKey && isVideo({ path: file.path })) {
						actions.push(
							renderButton('watch', {
								text: 'Watch',
								data: {
									watch: '1',
									// A real torrent already has the resolved link, so
									// watching it never re-adds the magnet. A fake one is
									// built from search results and only has the hash.
									...(rdInfo.fake ? {} : { 'watch-link': fileLink }),
									'watch-file-id': String(file.id),
									// Sent alongside fileId because a fake info object is
									// built from search results, whose file ids may have
									// come from a different service's availability check.
									'watch-file-name': file.path,
								},
							})
						);
					}

					const { isTvEpisode } = getEpisodeInfo(file.path, mediaType);
					if (
						serviceKey &&
						imdbId &&
						(mediaType === 'movie' || (mediaType === 'tv' && isTvEpisode))
					) {
						actions.push(
							renderButton('cast', {
								link: `/api/stremio/cast/${imdbId}`,
								linkParams: [
									{ name: 'token', value: serviceKey },
									{ name: 'hash', value: info.hash },
									{ name: 'fileId', value: String(file.id) },
									{ name: 'mediaType', value: mediaType },
								],
								text: 'Cast',
							})
						);
					}
				}
			}
			return renderFileRow(
				{
					id: file.id,
					path: file.path,
					size: file.bytes,
					isSelected: file.selected === 1,
					actions,
				},
				showCheckbox
			);
		});
		return filesList.join('');
	} else {
		const adInfo = info;
		adInfo.links.sort((a: MagnetLink, b: MagnetLink) => a.filename.localeCompare(b.filename));
		const filesList = adInfo.links.map((file: MagnetLink) => {
			const isPlayable = Boolean(isVideo({ path: file.filename }));
			const actions = file.link
				? [
						renderButton('download', {
							link: 'https://alldebrid.com/service/',
							linkParam: { name: 'url', value: file.link },
							text: 'DL',
						}),
					]
				: [];
			// A library magnet's row already holds an alldebrid.com/f/ link, so the
			// server only has to unlock it. A search result has no link yet, and the
			// magnet upload that produces one is refused from datacenter IPs — so
			// that row watches by hash and the upload happens in the browser.
			if (isPlayable && app && serviceKey) {
				actions.push(
					renderButton('watch', {
						text: 'Watch',
						data: {
							watch: '1',
							...(file.link ? { 'watch-link': file.link } : {}),
							'watch-file-name': file.filename,
						},
					})
				);
			}
			return renderFileRow({
				id: 0,
				path: file.filename,
				size: file.size,
				isPlayable,
				actions,
			});
		});
		return filesList.join('');
	}
};

export const renderTorrentInfoTB = (
	files: TorBoxFile[],
	options: { tbKey?: string; app?: string; hash?: string } = {}
) => {
	const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
	const filesList = sorted.map((file) => {
		const isPlayable = Boolean(isVideo({ path: file.name }));
		const actions: string[] = [];
		if (isPlayable && options.app && options.tbKey && options.hash) {
			actions.push(
				renderButton('watch', {
					text: 'Watch',
					data: { watch: '1', 'watch-file-name': file.name },
				})
			);
		}
		return renderFileRow({
			id: file.id,
			path: file.name,
			size: file.size,
			isPlayable,
			actions,
		});
	});
	return filesList.join('');
};

export interface PremiumizeFileRow {
	/** Premiumize file id - the handle `item/details` mints a fresh link from. */
	fileId: string;
	filename: string;
	filesize: number;
}

/**
 * File rows for a Premiumize library item.
 *
 * "Watch" needs the info hash, because it resolves through `transfer/directdl` -
 * and a Premiumize row only has a hash while its transfer is still in the list.
 * "DL" works either way: it mints a link from the file id, which every row has.
 */
export const renderTorrentInfoPM = (
	files: PremiumizeFileRow[],
	options: { canWatch?: boolean } = {}
) => {
	const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
	return sorted
		.map((file) => {
			const isPlayable = Boolean(isVideo({ path: file.filename }));
			const actions: string[] = [];
			if (isPlayable && options.canWatch) {
				actions.push(
					renderButton('watch', {
						text: 'Watch',
						data: { watch: '1', 'watch-file-name': file.filename },
					})
				);
			}
			actions.push(
				renderButton('download', {
					text: 'DL',
					data: { 'pm-file-id': file.fileId, 'pm-file-name': file.filename },
				})
			);
			return renderFileRow({
				id: 0,
				path: file.filename,
				size: file.filesize,
				isPlayable,
				actions,
			});
		})
		.join('');
};

export interface OffcloudFileRow {
	/** The signed energycdn URL `cloud/explore` handed back for this file. */
	link: string;
	filename: string;
	/** `cache/info` knows the size; explore does not, so it can be missing. */
	filesize: number | null;
}

/**
 * File rows for an Offcloud library item.
 *
 * Offcloud's links come out of `cloud/explore` already playable - keyless, any
 * IP, Range honoured, the same energycdn objects Premiumize serves - so both
 * buttons work off the link itself and neither needs the info hash. "DL" opens
 * it directly; "Watch" hands it to `openWatch`, which passes it through as a
 * link rather than resolving a hash.
 *
 * `cloud/explore` returns a bare array of URLs with no names and no sizes, so a
 * file whose metadata `cache/info` did not cover still gets a row, showing its
 * decoded basename and a zero size rather than disappearing from the listing.
 */
export const renderTorrentInfoOC = (
	files: OffcloudFileRow[],
	options: { canWatch?: boolean } = {}
) => {
	const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
	return sorted
		.map((file) => {
			const isPlayable = Boolean(isVideo({ path: file.filename }));
			const actions: string[] = [];
			if (isPlayable && options.canWatch) {
				actions.push(
					renderButton('watch', {
						text: 'Watch',
						data: {
							watch: '1',
							'watch-link': file.link,
							'watch-file-name': file.filename,
						},
					})
				);
			}
			actions.push(
				renderButton('download', {
					text: 'DL',
					data: { 'oc-link': file.link, 'oc-file-name': file.filename },
				})
			);
			return renderFileRow({
				id: 0,
				path: file.filename,
				size: file.filesize ?? 0,
				isPlayable,
				actions,
			});
		})
		.join('');
};

export interface DebridLinkFileRow {
	/** The keyless `https://seedN.debrid.link/dl/<torrentid>-<n>/<name>` URL. */
	downloadUrl: string;
	filename: string;
	filesize: number;
}

/**
 * File rows for a Debrid-Link library item.
 *
 * Every row already carries its own playable URL, so neither button resolves
 * anything: a Debrid-Link download link has no token, no signature, no
 * timestamp and no IP binding - the torrent id is the whole capability, and the
 * trailing filename is decorative. "DL" opens it; "Watch" hands it to
 * `openWatch`, which passes a link straight through to the player intent.
 *
 * That portability is also why these URLs are built here, at open time, from a
 * fresh fetch rather than read back off the stored row - see
 * `convertToDlUserTorrent`.
 */
export const renderTorrentInfoDL = (
	files: DebridLinkFileRow[],
	options: { canWatch?: boolean } = {}
) => {
	const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
	return sorted
		.map((file) => {
			const isPlayable = Boolean(isVideo({ path: file.filename }));
			const actions: string[] = [];
			if (isPlayable && options.canWatch && file.downloadUrl) {
				actions.push(
					renderButton('watch', {
						text: 'Watch',
						data: {
							watch: '1',
							'watch-link': file.downloadUrl,
							'watch-file-name': file.filename,
						},
					})
				);
			}
			if (file.downloadUrl) {
				actions.push(
					renderButton('download', {
						text: 'DL',
						data: { 'dl-link': file.downloadUrl, 'dl-file-name': file.filename },
					})
				);
			}
			return renderFileRow({
				id: 0,
				path: file.filename,
				size: file.filesize ?? 0,
				isPlayable,
				actions,
			});
		})
		.join('');
};
