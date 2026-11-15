// @vitest-environment node
//
// Node, not jsdom: the client aborts its own timeouts with an AbortController,
// and jsdom's AbortSignal is a different realm's object than the undici fetch
// underneath it, which rejects it outright. A browser has one realm for both.
import { describe, expect, it } from 'vitest';
import {
	addPutioTransfer,
	cancelPutioTransfers,
	deletePutioFiles,
	getPutioAccountInfo,
	getPutioTransfer,
	listPutioTransferFiles,
	listPutioTransfers,
	putioTransferHash,
} from './putio';

/**
 * Opt-in live checks against a real put.io account.
 *
 * Skipped unless PUTIO_LIVE_TOKEN is set, so `npm run test` never reaches put.io.
 * The default checks only read: the account, the transfer list and the root folder.
 * PUTIO_LIVE_MUTATE=1 also adds PUTIO_LIVE_HASH (Big Buck Bunny by default) unless
 * the account already holds it (put.io does not dedupe), then deletes its files and
 * cancels the transfer. Deleted files sit in put.io's trash and still count against
 * the storage until the trash is emptied on put.io.
 *
 *	PUTIO_LIVE_TOKEN=<token> npx vitest run --config vitest.live.config.ts src/services/putio.live.test.ts
 *
 * Nothing is printed from the account: put.io asks apps to keep file names, URLs and
 * tokens out of logs.
 */
const TOKEN = process.env.PUTIO_LIVE_TOKEN;
const MUTATE = process.env.PUTIO_LIVE_MUTATE === '1';
const HASH = process.env.PUTIO_LIVE_HASH ?? 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

describe.skipIf(!TOKEN)('Integration: put.io live reads', () => {
	it('reads the account, every transfer page and the root folder', async () => {
		const info = await getPutioAccountInfo(TOKEN!);
		expect(typeof info.user_id).toBe('number');
		expect(typeof info.account_status).toBe('string');

		const transfers = await listPutioTransfers(TOKEN!);
		expect(new Set(transfers.map((t) => t.id)).size).toBe(transfers.length);
		for (const transfer of transfers) {
			expect(typeof transfer.id).toBe('number');
			expect(typeof transfer.status).toBe('string');
		}

		// The root folder, walked within the client's bounds.
		const root = await listPutioTransferFiles(TOKEN!, 0);
		for (const file of root.files) expect(typeof file.id).toBe('number');

		const withFiles = transfers.find((t) => typeof t.file_id === 'number' && t.file_id > 0);
		if (withFiles) {
			const { files } = await listPutioTransferFiles(TOKEN!, withFiles.file_id!);
			for (const file of files) expect(typeof file.id).toBe('number');
		}

		console.log(
			`live: status=${info.account_status} transfers=${transfers.length} withFiles=${Boolean(withFiles)}`
		);
	}, 60_000);
});

describe.skipIf(!TOKEN || !MUTATE)('Integration: put.io live add (PUTIO_LIVE_MUTATE=1)', () => {
	it('adds a magnet, reads it back by id and removes it again', async () => {
		const held = (await listPutioTransfers(TOKEN!)).some((t) => putioTransferHash(t) === HASH);
		if (held) {
			console.log('live: the account already holds the hash; not adding a second copy');
			return;
		}
		const added = await addPutioTransfer(TOKEN!, `magnet:?xt=urn:btih:${HASH}`);
		await new Promise((resolve) => setTimeout(resolve, 3000));
		const fresh = await getPutioTransfer(TOKEN!, added.id);
		expect(fresh.id).toBe(added.id);
		if (typeof fresh.file_id === 'number' && fresh.file_id > 0) {
			await deletePutioFiles(TOKEN!, [fresh.file_id]);
		}
		await cancelPutioTransfers(TOKEN!, [added.id]);
		console.log(
			`live: added status=${added.status} now=${fresh.status} file_id=${fresh.file_id}`
		);
	}, 60_000);
});
