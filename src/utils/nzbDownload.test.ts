import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCleanNzb, filenameFromDisposition, parseRemoved } from './nzbDownload';

function response(
	overrides: Omit<Partial<Response>, 'headers'> & { headers?: Record<string, string> } = {}
) {
	return {
		ok: true,
		status: 200,
		blob: async () => new Blob(['<nzb/>'], { type: 'application/x-nzb' }),
		json: async () => ({}),
		...overrides,
		// After the spread: the caller passes headers as a plain record.
		headers: new Headers(overrides.headers ?? {}),
	} as unknown as Response;
}

const clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
	clicked.length = 0;
	vi.stubGlobal('URL', {
		...window.URL,
		createObjectURL: vi.fn(() => 'blob:nzb'),
		revokeObjectURL: vi.fn(),
	});
	// jsdom has no navigation, so a real click would warn and do nothing useful.
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		clicked.push(this);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('filenameFromDisposition', () => {
	it('prefers the encoded form, which survives a non-ASCII release name', () => {
		expect(
			filenameFromDisposition(
				`attachment; filename="Amelie.nzb"; filename*=UTF-8''Am%C3%A9lie.nzb`
			)
		).toBe('Amélie.nzb');
	});

	it('falls back to the quoted form', () => {
		expect(filenameFromDisposition('attachment; filename="My.Release.nzb"')).toBe(
			'My.Release.nzb'
		);
	});

	it('falls back again when the encoded form is malformed', () => {
		expect(
			filenameFromDisposition(`attachment; filename="ok.nzb"; filename*=UTF-8''%E0%A4%A`)
		).toBe('ok.nzb');
	});

	it('returns null when there is nothing to read', () => {
		expect(filenameFromDisposition(null)).toBeNull();
		expect(filenameFromDisposition('attachment')).toBeNull();
	});
});

describe('parseRemoved', () => {
	it('splits the list the server sent', () => {
		expect(parseRemoved('<meta type="tag"> (abc); DOCTYPE; post dates')).toEqual([
			'<meta type="tag"> (abc)',
			'DOCTYPE',
			'post dates',
		]);
	});

	// The server sends `-` rather than an empty header, which some proxies drop.
	it('reads the empty marker as nothing removed', () => {
		expect(parseRemoved('-')).toEqual([]);
		expect(parseRemoved(null)).toEqual([]);
	});
});

describe('downloadCleanNzb', () => {
	it('asks for the release, saves the file and reports what came off', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			response({
				headers: {
					'Content-Disposition': 'attachment; filename="My.Release.nzb"',
					'X-Nzb-Removed': '<meta type="tag"> (abc); DOCTYPE',
				},
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await downloadCleanNzb('ds:abc123', 'My.Release');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/nzb2rd/download?id=ds%3Aabc123&title=My.Release'
		);
		expect(result).toEqual({
			name: 'My.Release.nzb',
			removed: ['<meta type="tag"> (abc)', 'DOCTYPE'],
		});
		expect(clicked).toHaveLength(1);
		expect(clicked[0].download).toBe('My.Release.nzb');
	});

	it('names the file itself when the server does not', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));

		const result = await downloadCleanNzb('ds:abc123', 'My.Release');

		expect(result.name).toBe('My.Release.nzb');
		expect(result.removed).toEqual([]);
	});

	it('surfaces the server error rather than saving an error page', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				response({
					ok: false,
					status: 502,
					json: async () => ({ error: 'Could not download the NZB from the indexer' }),
				})
			)
		);

		await expect(downloadCleanNzb('ds:abc123', 'My.Release')).rejects.toThrow(
			'Could not download the NZB from the indexer'
		);
		expect(clicked).toHaveLength(0);
	});

	it('still says something when the error body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				response({
					ok: false,
					status: 429,
					json: async () => {
						throw new Error('not json');
					},
				})
			)
		);

		await expect(downloadCleanNzb('ds:abc123', 'My.Release')).rejects.toThrow(
			'Download failed (429)'
		);
	});
});
