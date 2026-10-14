import { repository as db } from '@/services/repository';

/**
 * The names DMM's Real-Debrid availability row records for this hash: RD's own
 * name for the torrent, then the selected file's. For a server-side add that
 * has nothing but the hash (a cast, a player link), so a 451 on a name RD
 * blocks reads as that and not as the account's pause (`RdAddOptions.names`).
 * A lookup that fails answers no names, which leaves the add as it was.
 */
export async function rdNamesOnRecord(hash: string): Promise<string[]> {
	try {
		const row = (await db.getCachedRdNames([hash])).get(hash.toLowerCase());
		return row ? [row.originalFilename, row.filename] : [];
	} catch {
		return [];
	}
}
