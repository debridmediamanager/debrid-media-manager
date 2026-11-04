import matrixWholePass from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-matrix-whole-pass.json';
import { TorrentSnapshot, toStoredSnapshot } from '@/utils/torrentSnapshot';

const payload = toStoredSnapshot(TorrentSnapshot.parse(matrixWholePass));

// zurg's recorded post of The Matrix (1999) 2160p Tigole, as getSnapshotsByHashes
// returns the row: every audio track tagged `eng`.
export const matrixSnapshotRow = { hash: payload.Hash, payload };
