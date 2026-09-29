import handler from '@/pages/api/hashlists';
import { createMockRequest } from '@/test/utils/api';
import { readFileSync } from 'fs';
import lzString from 'lz-string';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The 1.98 MB list from the white-page report (fixtures/hashlist/README.md).
const FRAGMENT = readFileSync(
	path.join(__dirname, '../fixtures/hashlist/421ab9ff-ed7f-4c0b-9f66-ee91f12d57eb.fragment.txt'),
	'utf8'
);

// Mock the UUID module
vi.mock('uuid', () => ({
	v4: () => 'test-uuid-123',
}));

// Mock Octokit
vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({
		rest: {
			git: {
				getRef: vi.fn().mockResolvedValue({
					data: {
						object: { sha: 'test-commit-sha' },
					},
				}),
				createBlob: vi.fn().mockResolvedValue({
					data: { sha: 'test-blob-sha' },
				}),
				createTree: vi.fn().mockResolvedValue({
					data: { sha: 'test-tree-sha' },
				}),
				createCommit: vi.fn().mockResolvedValue({
					data: { sha: 'test-new-commit-sha' },
				}),
				updateRef: vi.fn().mockResolvedValue({}),
			},
		},
	})),
}));

describe('/api/hashlists', () => {
	let mockReq: any;
	let mockRes: any;

	beforeEach(() => {
		mockReq = createMockRequest();
		mockRes = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
			send: vi.fn().mockReturnThis(),
			_getStatusCode: () => 200,
			_getData: () => ({}),
			_getHeaders: () => ({}),
			_setStatusCode: vi.fn(),
		} as any;

		// Set required environment variable
		process.env.GH_PAT = 'test-token';

		vi.clearAllMocks();
	});

	it('should return 405 for non-POST requests', async () => {
		mockReq.method = 'GET';
		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(405);
		expect(mockRes.json).toHaveBeenCalledWith({ message: 'Method not allowed' });
	});

	it('should return 400 when URL is missing', async () => {
		mockReq.method = 'POST';
		mockReq.body = {};
		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(400);
		expect(mockRes.json).toHaveBeenCalledWith({ message: 'URL is required' });
	});

	it('should create short URL successfully', async () => {
		mockReq.method = 'POST';
		mockReq.body = { url: 'https://example.com' };

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(200);
		expect(mockRes.json).toHaveBeenCalledWith({
			shortUrl: 'https://hashlists.debridmediamanager.com/test-uuid-123.html',
		});
	});

	it('should handle API errors gracefully', async () => {
		const { Octokit } = await import('@octokit/rest');
		vi.mocked(Octokit).mockImplementation(
			() =>
				({
					rest: {
						git: {
							getRef: vi.fn().mockRejectedValue(new Error('GitHub API error')),
							createBlob: vi.fn(),
							createTree: vi.fn(),
							createCommit: vi.fn(),
							updateRef: vi.fn(),
						},
					},
				}) as any
		);

		mockReq.method = 'POST';
		mockReq.body = { url: 'https://example.com' };

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(500);
		expect(mockRes.send).toHaveBeenCalledWith('Error adding file to GitHub repository');
	});

	describe('a list sent as data', () => {
		const git = () => {
			const created = { blobs: [] as string[], tree: [] as { path: string; sha: string }[] };
			const api = {
				getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'head' } } }),
				createBlob: vi.fn(async ({ content }: { content: string }) => {
					created.blobs.push(content);
					return { data: { sha: `blob-${created.blobs.length}` } };
				}),
				createTree: vi.fn(async ({ tree }: { tree: { path: string; sha: string }[] }) => {
					created.tree = tree;
					return { data: { sha: 'tree' } };
				}),
				createCommit: vi.fn().mockResolvedValue({ data: { sha: 'commit' } }),
				updateRef: vi.fn().mockResolvedValue({}),
			};
			return { created, api };
		};
		const install = async (api: object) => {
			const { Octokit } = await import('@octokit/rest');
			vi.mocked(Octokit).mockImplementation(() => ({ rest: { git: api } }) as any);
		};
		const blobAt = (created: ReturnType<typeof git>['created'], file: string) =>
			created.blobs[Number(created.tree.find((e) => e.path === file)!.sha.split('-')[1]) - 1];

		// Before: the page's iframe carried the whole list, and past 2 MB Chrome
		// refuses the URL and shows a white page. 149 lists were past it.
		it('stores the list beside a page whose iframe URL stays short', async () => {
			const { created, api } = git();
			await install(api);
			mockReq.method = 'POST';
			mockReq.body = { data: FRAGMENT };

			await handler(mockReq, mockRes);

			expect(mockRes.status).toHaveBeenCalledWith(200);
			expect(mockRes.json).toHaveBeenCalledWith({
				shortUrl: 'https://hashlists.debridmediamanager.com/test-uuid-123.html',
			});
			expect(created.tree.map((e) => e.path)).toEqual([
				'test-uuid-123.html',
				'lists/test-uuid-123.txt',
			]);
			expect(api.createCommit).toHaveBeenCalledTimes(1);
			expect(blobAt(created, 'lists/test-uuid-123.txt')).toBe(FRAGMENT);
			const html = blobAt(created, 'test-uuid-123.html');
			expect(html).toContain(
				'<iframe src="https://debridmediamanager.com/hashlist#id=test-uuid-123"></iframe>'
			);
			expect(html.length).toBeLessThan(1000);
		});

		it('refuses data that is not an lz-string hash list', async () => {
			const { api } = git();
			await install(api);
			mockReq.method = 'POST';
			for (const data of [
				'not lz text!',
				lzString.compressToEncodedURIComponent('{"title":"x"}'),
				lzString.compressToEncodedURIComponent('plain text'),
				42,
			]) {
				mockReq.body = { data };
				await handler(mockReq, mockRes);
				expect(mockRes.status).toHaveBeenLastCalledWith(400);
			}
			expect(api.createBlob).not.toHaveBeenCalled();
		});

		it('accepts the bare array a single-torrent share carries', async () => {
			const { created, api } = git();
			await install(api);
			mockReq.method = 'POST';
			mockReq.body = {
				data: lzString.compressToEncodedURIComponent(
					JSON.stringify([{ filename: 'a', hash: 'b'.repeat(40), bytes: 1 }])
				),
			};
			await handler(mockReq, mockRes);
			expect(mockRes.status).toHaveBeenCalledWith(200);
			expect(created.tree).toHaveLength(2);
		});

		// Pages loaded before the change still send the whole list as a URL.
		it('still writes the old single-file page for a url', async () => {
			const { created, api } = git();
			await install(api);
			mockReq.method = 'POST';
			mockReq.body = { url: 'https://debridmediamanager.com/hashlist#abc' };
			await handler(mockReq, mockRes);
			expect(created.tree.map((e) => e.path)).toEqual(['test-uuid-123.html']);
			expect(created.blobs[0]).toContain(
				'<iframe src="https://debridmediamanager.com/hashlist#abc"></iframe>'
			);
		});
	});
});
