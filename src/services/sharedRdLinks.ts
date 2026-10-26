import { checkRdLink } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import type { TorrentSnapshot } from '@/utils/torrentSnapshot';

// zurg sends each Real-Debrid file's code cut to 13 characters; a zurg from
// before the snapshot allowlist sent the account's full 16.
const RD_CODE = /^(https:\/\/real-debrid\.com\/d\/[A-Za-z0-9]{13})[A-Za-z0-9]{0,3}$/;

/**
 * Files the Real-Debrid codes a zurg snapshot carries into `Available`, where the
 * RD Cast stream pool offers them to everyone: played by unrestricting the code,
 * they add nothing to the player's account. Without them a stream addon adds a
 * torrent per title it is asked about (rex-stremio on a VPS, 2026-10-26).
 *
 * The snapshot route takes posts without a token, so a code is filed only after
 * Real-Debrid names the same file for it, by name and exact size, and a release
 * only when every one of its codes does, as `/api/availability` refuses a
 * partly expired torrent. Answers how many files it filed.
 */
export async function fileSharedRdLinks(snapshot: TorrentSnapshot): Promise<number> {
	const imdbId = snapshot.IMDBID ?? '';
	if (!/^tt\d+$/.test(imdbId)) return 0;
	const files = Object.values(snapshot.SelectedFiles).flatMap((file) => {
		const code = file.State === 'ok_file' && file.selected === 1 && file.Link?.match(RD_CODE);
		return code ? [{ ...file, link: code[1] }] : [];
	});
	if (files.length === 0) return 0;
	const known = await Promise.all(files.map((file) => repository.getHashByLink(file.link)));
	if (known.every((hash) => hash === snapshot.Hash)) return 0;

	// One at a time: a forged post is a run of unknown codes, which Real-Debrid throttles.
	for (const file of files) {
		const answer = await checkRdLink(file.link);
		if (answer?.filename !== file.path.split('/').pop() || answer?.filesize !== file.bytes) {
			return 0;
		}
	}
	const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
	await repository.upsertAvailability({
		hash: snapshot.Hash,
		imdbId,
		filename: snapshot.Name,
		originalFilename: snapshot.OriginalName,
		bytes,
		originalBytes: bytes,
		host: 'real-debrid.com',
		progress: 100,
		status: 'downloaded',
		ended:
			files
				.map((file) => file.Ended)
				.filter(Boolean)
				.sort()
				.pop() || snapshot.Added,
		selectedFiles: files.map(({ id, path, bytes, selected }) => ({
			id,
			path,
			bytes,
			selected,
		})),
		links: files.map((file) => file.link),
	});
	return files.length;
}
