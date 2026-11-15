import account from '@/test/fixtures/putio/account.json';
import files from '@/test/fixtures/putio/files.json';
import oauth from '@/test/fixtures/putio/oauth.json';
import recorded from '@/test/fixtures/putio/recorded-2026-11-15.json';
import paid from '@/test/fixtures/putio/recorded-paid-2026-11-15.json';
import transfers from '@/test/fixtures/putio/transfers.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ADD_MULTI_CHUNK_SIZE,
	FILES_PAGE_SIZE,
	MAX_FOLDER_DEPTH,
	MAX_LISTED_FILES,
	PutioError,
	RATE_LIMIT_BACKOFF_MS,
	TRANSFERS_PAGE_SIZE,
	_testing,
	addPutioTransfer,
	addPutioTransfers,
	cancelPutioTransfers,
	checkPutioDeviceCode,
	deletePutioFiles,
	getPutioAccountInfo,
	getPutioDownloadUrl,
	getPutioTransferInfo,
	isPutioActive,
	isPutioAuthError,
	listPutioTransferFiles,
	listPutioTransfers,
	putioLinkUrl,
	putioTransferHash,
	removePutioTransfers,
	requestPutioDeviceCode,
} from './putio';

const TOKEN = 'pt-test-token';
const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Big+Buck+Bunny`;

const reply = (body: unknown, status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	}) as unknown as Response;

const recordedReply = (name: keyof typeof recorded) =>
	reply(recorded[name].body, recorded[name].status ?? 200);
const paidReply = (name: keyof typeof paid) => reply(paid[name].body, paid[name].status);

const fetchMock = vi.fn();

/** The url, method, headers and form fields of the nth fetch. */
const call = (n: number) => {
	const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
	const parsed = new URL(url);
	return {
		path: parsed.pathname,
		query: Object.fromEntries(parsed.searchParams),
		method: init.method,
		headers: init.headers as Record<string, string>,
		form: init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined,
		body: init.body,
	};
};

beforeEach(() => {
	_testing.resetRateLimit();
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('put.io request envelope', () => {
	it('sends the token as a Bearer header, never in the query', async () => {
		fetchMock.mockResolvedValueOnce(reply(account));
		const info = await getPutioAccountInfo(TOKEN);
		expect(info.username).toBe('someone');
		expect(isPutioActive(info)).toBe(true);
		const { path, query, headers } = call(0);
		expect(path).toBe('/v2/account/info');
		expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
		expect(Object.values(query)).not.toContain(TOKEN);
	});

	it('signs in an account with no plan and reports it as inactive (recorded)', async () => {
		fetchMock.mockResolvedValueOnce(recordedReply('account-info-unpaid'));
		const info = await getPutioAccountInfo(TOKEN);
		expect(info.account_status).toBe('stranger');
		expect(info.disk).toEqual({ avail: 0, size: 0, used: 0 });
		expect(isPutioActive(info)).toBe(false);
	});

	it('turns a 401 into an auth error with a readable message (recorded)', async () => {
		fetchMock.mockResolvedValueOnce(recordedReply('bad-token'));
		const error = await getPutioAccountInfo(TOKEN).catch((e) => e);
		expect(error).toBeInstanceOf(PutioError);
		expect(error.status).toBe(401);
		expect(error.code).toBe('Unauthorized');
		expect(isPutioAuthError(error)).toBe(true);
		expect(error.message).not.toContain('could not verify');
	});

	it('reads a 404 as NotFound, not as signed out (recorded)', async () => {
		fetchMock.mockResolvedValueOnce(recordedReply('transfer-missing'));
		const error = await listPutioTransfers(TOKEN).catch((e) => e);
		expect(error.code).toBe('NotFound');
		expect(isPutioAuthError(error)).toBe(false);
	});

	it('keeps a network failure apart from a refusal', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		const error = await getPutioAccountInfo(TOKEN).catch((e) => e);
		expect(error.code).toBe('network_error');
		expect(isPutioAuthError(error)).toBe(false);
	});

	it('refuses a 200 that is not JSON', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => {
				throw new SyntaxError('Unexpected token <');
			},
		});
		await expect(getPutioAccountInfo(TOKEN)).rejects.toMatchObject({
			code: 'non_json_response',
		});
	});

	it('stands down for the whole window after a 429 without calling put.io', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		fetchMock.mockResolvedValueOnce(reply({ status: 'ERROR' }, 429));
		await expect(getPutioAccountInfo(TOKEN)).rejects.toMatchObject({ code: 'rate_limited' });
		await expect(listPutioTransfers(TOKEN)).rejects.toMatchObject({ code: 'rate_limited' });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.setSystemTime(Date.now() + RATE_LIMIT_BACKOFF_MS + 1);
		fetchMock.mockResolvedValueOnce(reply(account));
		await expect(getPutioAccountInfo(TOKEN)).resolves.toMatchObject({ user_id: 424242 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('listPutioTransfers', () => {
	it('asks for pages and follows the cursor until it runs out (recorded pages)', async () => {
		// Recorded at per_page=2 over five transfers: two pages carry a cursor. The
		// last page is modelled by the recorded cursor-less one-transfer listing.
		fetchMock
			.mockResolvedValueOnce(paidReply('transfers-list-four'))
			.mockResolvedValueOnce(paidReply('transfers-list-continue'))
			.mockResolvedValueOnce(paidReply('transfers-list-one'));
		const all = await listPutioTransfers(TOKEN);
		expect(all).toHaveLength(paid['transfers-list-four'].body.total);

		const first = call(0);
		expect(first.path).toBe('/v2/transfers/list');
		// Without per_page put.io returns the 1000 *oldest* transfers.
		expect(first.query.per_page).toBe(String(TRANSFERS_PAGE_SIZE));
		expect(call(1)).toMatchObject({
			path: '/v2/transfers/list/continue',
			method: 'POST',
			query: { per_page: String(TRANSFERS_PAGE_SIZE) },
			form: { cursor: paid['transfers-list-four'].body.cursor },
		});
		expect(call(2).form).toEqual({ cursor: paid['transfers-list-continue'].body.cursor });
	});

	it('follows a schema-shaped cursor too', async () => {
		fetchMock
			.mockResolvedValueOnce(reply(transfers.list))
			.mockResolvedValueOnce(reply(transfers.continue));
		const all = await listPutioTransfers(TOKEN);
		expect(all).toHaveLength(
			transfers.list.transfers.length + transfers.continue.transfers.length
		);
		const next = call(1);
		expect(next.path).toBe('/v2/transfers/list/continue');
		expect(next.method).toBe('POST');
		expect(next.form).toEqual({ cursor: 'fixture-cursor-1' });
	});

	it('reads an empty account (recorded)', async () => {
		fetchMock.mockResolvedValueOnce(recordedReply('transfers-list-empty'));
		await expect(listPutioTransfers(TOKEN)).resolves.toEqual([]);
	});

	it('throws instead of returning part of the list when a page fails', async () => {
		fetchMock
			.mockResolvedValueOnce(reply(transfers.list))
			.mockResolvedValueOnce(reply({ status: 'ERROR', error_type: 'Boom' }, 500));
		await expect(listPutioTransfers(TOKEN)).rejects.toMatchObject({ status: 500 });
	});

	it('stops a cursor that never ends', async () => {
		fetchMock.mockResolvedValue(reply({ status: 'OK', transfers: [], cursor: 'again' }));
		await expect(listPutioTransfers(TOKEN)).rejects.toMatchObject({ code: 'too_many_pages' });
	});
});

describe('adding', () => {
	it('validates the info hash before any request', async () => {
		await expect(addPutioTransfer(TOKEN, 'magnet:?xt=urn:btih:zzzz')).rejects.toMatchObject({
			code: 'invalid_info_hash',
		});
		await expect(addPutioTransfers(TOKEN, [MAGNET, 'not a hash'])).rejects.toMatchObject({
			code: 'invalid_info_hash',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('checks the size against free space, then adds the magnet as a form field', async () => {
		fetchMock
			.mockResolvedValueOnce(paidReply('transfers-info-paid'))
			.mockResolvedValueOnce(paidReply('transfers-add-known'));
		const transfer = await addPutioTransfer(TOKEN, MAGNET);
		expect(transfer.id).toBe(paid['transfers-add-known'].body.transfer.id);
		// What the add answers is not yet a usable row (recorded): see convertToPutioUserTorrent.
		expect(transfer).toMatchObject({ status: 'PREPARING_DOWNLOAD', hash: null, file_id: null });
		expect(call(0)).toMatchObject({ path: '/v2/transfers/info', form: { urls: MAGNET } });
		expect(call(1)).toMatchObject({ path: '/v2/transfers/add', form: { url: MAGNET } });
	});

	it('refuses before adding when the release does not fit (recorded info answer)', async () => {
		// The recorded no-plan account: 0 free, a 263.6 MB release.
		fetchMock.mockResolvedValueOnce(recordedReply('transfers-info-unpaid'));
		const error = await addPutioTransfer(TOKEN, MAGNET).catch((e) => e);
		expect(error.code).toBe('not_enough_space');
		expect(error.message).toMatch(/no free space, or .* no active plan/);
		// Deleted files still count until put.io's trash is emptied (recorded).
		expect(error.message).toMatch(/trash/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('names both sizes when there is some space but not enough', async () => {
		fetchMock.mockResolvedValueOnce(
			reply({ status: 'OK', disk_avail: 1024 ** 3, ret: [{ file_size: 3 * 1024 ** 3 }] })
		);
		await expect(addPutioTransfer(TOKEN, MAGNET)).rejects.toThrow(
			'this needs 3.0 GB and 1.0 GB is free'
		);
	});

	it('shows the no-plan message on a 402 and does not retry (recorded)', async () => {
		fetchMock
			.mockResolvedValueOnce(reply({ status: 'OK', disk_avail: 0, ret: [{ file_size: 0 }] }))
			.mockResolvedValueOnce(recordedReply('transfers-add-unpaid'));
		const error = await addPutioTransfer(TOKEN, MAGNET).catch((e) => e);
		expect(error.status).toBe(402);
		expect(error.message).toBe('Your put.io account has no active plan.');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('sends add-multi as one JSON form field and returns the per-url errors (recorded)', async () => {
		const other = `magnet:?xt=urn:btih:${'16'.repeat(20)}`;
		fetchMock
			.mockResolvedValueOnce(paidReply('transfers-info-paid'))
			.mockResolvedValueOnce(paidReply('transfers-add-multi'));
		const result = await addPutioTransfers(TOKEN, [MAGNET, other]);
		expect(result.transfers).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({
			error_type: 'UNSUPPORTED_URI_SCHEME',
			status_code: 400,
		});
		expect(JSON.parse(call(1).form!.urls)).toEqual([{ url: MAGNET }, { url: other }]);
		expect(call(0).form!.urls).toBe(`${MAGNET}\n${other}`);
	});

	it('refuses an add-multi chunk above the limit', async () => {
		const many = Array.from({ length: ADD_MULTI_CHUNK_SIZE + 1 }, () => MAGNET);
		await expect(addPutioTransfers(TOKEN, many)).rejects.toMatchObject({
			code: 'too_many_urls',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reads sizes from transfers/info, zero for an unknown hash (recorded)', async () => {
		fetchMock.mockResolvedValueOnce(recordedReply('transfers-info-mixed'));
		const info = await getPutioTransferInfo(TOKEN, ['a', 'b']);
		expect(info).toEqual({ diskAvail: 0, sizes: [0, 129302391] });
	});
});

describe('removing', () => {
	it('refuses the root folder and other non-positive ids without a request', async () => {
		await expect(deletePutioFiles(TOKEN, [0])).rejects.toMatchObject({ code: 'invalid_id' });
		await expect(cancelPutioTransfers(TOKEN, [])).rejects.toMatchObject({
			code: 'invalid_id',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reads a refused URL as UNSUPPORTED_URI_SCHEME (recorded)', async () => {
		fetchMock
			.mockResolvedValueOnce(paidReply('transfers-info-paid'))
			.mockResolvedValueOnce(paidReply('transfers-add-garbage'));
		await expect(addPutioTransfer(TOKEN, MAGNET)).rejects.toMatchObject({
			status: 400,
			code: 'UNSUPPORTED_URI_SCHEME',
		});
	});

	it('posts comma-joined ids, skipping files that are already gone (recorded answers)', async () => {
		// Both answer 200 OK whether or not the ids exist, so an echo proves nothing.
		fetchMock
			.mockResolvedValueOnce(paidReply('files-delete-again'))
			.mockResolvedValueOnce(paidReply('transfers-cancel-unknown-id'))
			.mockResolvedValueOnce(paidReply('transfers-cancel-unknown-id'));
		await deletePutioFiles(TOKEN, [11, 12]);
		await cancelPutioTransfers(TOKEN, [3]);
		await removePutioTransfers(TOKEN, [3]);
		expect(call(0)).toMatchObject({
			path: '/v2/files/delete',
			query: { skip_nonexistents: 'true' },
			form: { file_ids: '11,12' },
		});
		expect(call(0).query.skip_trash).toBeUndefined();
		expect(call(1)).toMatchObject({
			path: '/v2/transfers/cancel',
			form: { transfer_ids: '3' },
		});
		expect(call(2)).toMatchObject({
			path: '/v2/transfers/remove',
			form: { transfer_ids: '3' },
		});
	});
});

describe('files and links', () => {
	it('walks a folder into its subfolders and keeps the paths', async () => {
		fetchMock
			.mockResolvedValueOnce(reply(files.folder))
			.mockResolvedValueOnce(reply(files.subfolder));
		const { files: listed, truncated } = await listPutioTransferFiles(TOKEN, 1009);
		expect(truncated).toBe(false);
		expect(listed.map((f) => f.path)).toEqual([
			'Example.Show.S01E01.1080p.mkv',
			'Example.Show.S01E02.1080p.mkv',
			'Extras/Readme.txt',
		]);
		expect(call(0).query).toMatchObject({ parent_id: '1009' });
		expect(call(1).query).toMatchObject({ parent_id: '1103' });
	});

	it('returns a single-file transfer as that one file', async () => {
		fetchMock.mockResolvedValueOnce(reply(files.singleFile));
		const { files: listed } = await listPutioTransferFiles(TOKEN, 1010);
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ id: 1010, path: 'Example.Movie.2026.1080p.mkv' });
	});

	it('says the list is cut when one folder holds more files than DMM lists', async () => {
		const page = (n: number, cursor: string | null) => ({
			status: 'OK',
			cursor,
			parent: { id: 1, name: 'big', file_type: 'FOLDER' },
			files: Array.from({ length: FILES_PAGE_SIZE }, (_, i) => ({
				id: n * FILES_PAGE_SIZE + i + 10,
				name: `f${n}-${i}.mkv`,
				file_type: 'VIDEO',
			})),
		});
		fetchMock
			.mockResolvedValueOnce(reply(page(0, 'c1')))
			.mockResolvedValueOnce(reply(page(1, 'c2')))
			.mockResolvedValueOnce(reply(page(2, null)));
		const { files: listed, truncated } = await listPutioTransferFiles(TOKEN, 1);
		expect(listed).toHaveLength(MAX_LISTED_FILES);
		expect(truncated).toBe(true);
	});

	it('stops descending past the depth bound and says so', async () => {
		let id = 1;
		fetchMock.mockImplementation(async () => {
			id++;
			return reply({
				status: 'OK',
				cursor: null,
				parent: { id, name: `d${id}`, file_type: 'FOLDER' },
				files: [{ id: id + 1, name: `d${id + 1}`, file_type: 'FOLDER' }],
			});
		});
		const { truncated } = await listPutioTransferFiles(TOKEN, 1);
		expect(truncated).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(MAX_FOLDER_DEPTH + 1);
	});

	it('mints a download link for one file', async () => {
		fetchMock.mockResolvedValueOnce(paidReply('file-url'));
		await expect(getPutioDownloadUrl(TOKEN, 1101)).resolves.toBe(paid['file-url'].body.url);
		expect(call(0).path).toBe('/v2/files/1101/url');
	});

	it('shows the no-plan message when a link is refused (recorded)', async () => {
		fetchMock.mockResolvedValueOnce(recordedReply('file-missing'));
		await expect(getPutioDownloadUrl(TOKEN, 1)).rejects.toThrow(
			'Your put.io account has no active plan.'
		);
	});
});

describe('device link', () => {
	it('asks for a code with the app id and no token', async () => {
		fetchMock.mockResolvedValueOnce(reply(oauth.code));
		await expect(requestPutioDeviceCode('10085')).resolves.toEqual({ code: 'TZLUOH' });
		expect(call(0).path).toBe('/v2/oauth2/oob/code');
		expect(call(0).query.app_id).toBe('10085');
		expect(call(0).headers.Authorization).toBeUndefined();
		expect(putioLinkUrl('TZLUOH')).toBe('https://app.put.io/link?code=TZLUOH');
	});

	it('reads pending as null, then the token, then a 404 for the spent code', async () => {
		fetchMock
			.mockResolvedValueOnce(reply(oauth.pending))
			.mockResolvedValueOnce(reply(oauth.linked))
			.mockResolvedValueOnce(recordedReply('transfer-missing'));
		await expect(checkPutioDeviceCode('TZLUOH')).resolves.toBeNull();
		await expect(checkPutioDeviceCode('TZLUOH')).resolves.toBe(oauth.linked.oauth_token);
		await expect(checkPutioDeviceCode('TZLUOH')).rejects.toMatchObject({ status: 404 });
		expect(call(0).path).toBe('/v2/oauth2/oob/code/TZLUOH');
		expect(call(0).headers.Authorization).toBeUndefined();
	});
});

describe('putioTransferHash', () => {
	it('prefers hash, falls back to a magnet source, and is empty for a URL transfer', () => {
		const [withHash] = transfers.list.transfers;
		const rest = transfers.continue.transfers;
		const magnetOnly = rest.find((t) => t.id === 9013)!;
		const urlOnly = rest.find((t) => t.id === 9014)!;
		expect(putioTransferHash(withHash)).toBe(withHash.hash);
		expect(magnetOnly.hash).toBeNull();
		expect(putioTransferHash(magnetOnly)).toBe('0d'.repeat(20));
		expect(putioTransferHash(urlOnly)).toBe('');
		expect(putioTransferHash({ hash: null, source: null })).toBe('');
	});
});
