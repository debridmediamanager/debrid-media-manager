import { showInfoForAD, showInfoForRD, showInfoForTB } from '@/components/showInfo';
import { SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import { WatchKeys, pickInfoService } from '@/utils/watchService';

/**
 * Opens the torrent info modal for a search result.
 *
 * The movie page and the season page built this by hand and picked the modal on
 * key presence alone, which put the modal's Watch rows on a service that did not
 * have the torrent cached. Both now share `pickInfoService`, so the modal agrees
 * with the Watch buttons on the result card.
 *
 * None of these objects come from the service's API - they are assembled from a
 * search result and carry `fake`, which is what tells the modal to leave out the
 * library actions (delete, reinsert, export) that need a real torrent id.
 */

const videoFiles = (result: SearchResult) =>
	result.files.filter((file) => isVideo({ path: file.filename }));

const buildRdInfo = (result: SearchResult): TorrentInfoResponse =>
	({
		id: '',
		filename: result.title,
		original_filename: result.title,
		hash: result.hash,
		bytes: result.fileSize * 1024 * 1024,
		original_bytes: result.fileSize,
		progress: 100,
		files: videoFiles(result).map((file) => ({
			id: file.fileId,
			path: file.filename,
			bytes: file.filesize,
			selected: 1,
		})),
		links: [],
		fake: true,
		host: '',
		split: 0,
		status: 'downloaded',
		added: '',
		ended: '',
		speed: 0,
		seeders: 0,
	}) as TorrentInfoResponse;

/**
 * AllDebrid's modal reads `links`, not `files`, and it used to be handed the
 * Real-Debrid shape above - so it rendered `NaN GB`, `Invalid Date` and an empty
 * file list. The links have no URL because an AllDebrid link only exists after a
 * `magnet/upload`, which AllDebrid refuses from a datacenter IP; the Watch rows
 * do that upload in the browser when they are clicked.
 */
const buildAdInfo = (result: SearchResult, adInLibrary: boolean) => ({
	id: '',
	hash: result.hash,
	filename: result.title,
	size: result.fileSize * 1024 * 1024,
	status: 'Ready',
	statusCode: 4,
	uploadDate: Math.floor(Date.now() / 1000),
	fake: true,
	// The browser-side upload dedupes onto whatever the account already holds, so
	// cleaning up afterwards would delete the user's own magnet. Same check the
	// Watch button on the result card makes.
	adInLibrary,
	links: videoFiles(result).map((file) => ({
		filename: file.filename,
		size: file.filesize,
		link: '',
	})),
});

const buildTbInfo = (result: SearchResult) => ({
	id: 0,
	hash: result.hash,
	created_at: '',
	updated_at: '',
	magnet: '',
	size: result.fileSize * 1024 * 1024,
	active: false,
	auth_id: '',
	download_state: 'downloaded',
	seeds: 0,
	peers: 0,
	ratio: 0,
	progress: 100,
	download_speed: 0,
	upload_speed: 0,
	name: result.title,
	eta: 0,
	server: 0,
	torrent_file: false,
	expires_at: '',
	download_present: true,
	download_finished: true,
	files: videoFiles(result).map((file, i) => ({
		id: i,
		name: file.filename,
		size: file.filesize,
	})),
	inactive_check: 0,
	availability: 0,
	fake: true,
});

export const showInfoForSearchResult = (opts: {
	result: SearchResult;
	keys: WatchKeys;
	player: string;
	imdbId: string;
	mediaType: 'movie' | 'tv';
	shouldDownloadMagnets?: boolean;
	/** Whether this hash is already a magnet in the user's AllDebrid library. */
	adInLibrary?: boolean;
}): void => {
	const { result, keys, player, imdbId, mediaType, shouldDownloadMagnets } = opts;
	const service = pickInfoService(result, keys);

	if (service === 'rd' && keys.rdKey) {
		void showInfoForRD(
			player,
			keys.rdKey,
			buildRdInfo(result),
			imdbId,
			mediaType,
			shouldDownloadMagnets
		);
		return;
	}
	if (service === 'ad' && keys.adKey) {
		void showInfoForAD(
			player,
			keys.adKey,
			buildAdInfo(result, Boolean(opts.adInLibrary)),
			imdbId,
			shouldDownloadMagnets
		);
		return;
	}
	if (service === 'tb' && keys.torboxKey) {
		void showInfoForTB(
			player,
			keys.torboxKey,
			buildTbInfo(result) as any,
			shouldDownloadMagnets
		);
	}
};
