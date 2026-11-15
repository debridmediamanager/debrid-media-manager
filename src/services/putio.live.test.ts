// @vitest-environment node
//
// Node, not jsdom: the client aborts its own timeouts with an AbortController,
// and jsdom's AbortSignal is a different realm's object than the undici fetch
// underneath it, which rejects it outright. A browser has one realm for both.
import { describe, expect, it } from 'vitest';
import {
	addPutioTransfer,
	cancelPutioTransfers,
	getPutioAccountInfo,
	getPutioTransfer,
	listPutioTransferFiles,
	listPutioTransfers,
} from './putio';

/**
 * Opt-in live checks against a real put.io account.
 *
 * Skipped unless PUTIO_LIVE_TOKEN is set, so `npm run test` never reaches put.io.
 * The default checks only read: the account, the transfer list and the root folder.
 * PUTIO_LIVE_MUTATE=1 also adds PUTIO_LIVE_HASH (Big Buck Bunny by default), which
 * spends the account's storage, and cancels the transfer again; its files stay.
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
	it('adds a magnet, reads it back by id and cancels it', async () => {
		const added = await addPutioTransfer(TOKEN!, `magnet:?xt=urn:btih:${HASH}`);
		const fresh = await getPutioTransfer(TOKEN!, added.id);
		expect(fresh.id).toBe(added.id);
		await cancelPutioTransfers(TOKEN!, [added.id]);
		console.log(
			`live: added status=${added.status} now=${fresh.status} file_id=${fresh.file_id}`
		);
	}, 60_000);
});
