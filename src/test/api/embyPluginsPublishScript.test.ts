import handler from '@/pages/api/emby-plugins/publish';
import type { EmbyPublishedPlugin } from '@/services/embyPlugins/catalog';
import { getStoredObject, putStoredObject } from '@/services/newznab/store';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { execFile, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The release job of each *-zurg-for-emby repository runs scripts/publish-emby-plugin.py
// (vendored as scripts/publish-to-dmm.py). This drives that script, unmodified, at the
// real publish handler over HTTP, so the request it builds is held to what the endpoint
// accepts rather than to a hand-written copy of it.

vi.mock('@/services/newznab/store', () => ({
	getStoredObject: vi.fn(),
	putStoredObject: vi.fn(),
}));

const redisState = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('ioredis', () => ({
	default: class FakeRedis {
		on() {
			return this;
		}
		async set(key: string, value: string, ...options: unknown[]) {
			if (options.includes('NX') && redisState.values.has(key)) return null;
			redisState.values.set(key, value);
			return 'OK';
		}
		async eval(_script: string, _keys: number, key: string, token: string) {
			if (redisState.values.get(key) !== token) return 0;
			redisState.values.delete(key);
			return 1;
		}
	},
}));

const mockGet = vi.mocked(getStoredObject);
const mockPut = vi.mocked(putStoredObject);

const SCRIPT = path.resolve(__dirname, '../../../scripts/publish-emby-plugin.py');
const SECRET = 'script-secret';
const GUID = '43175d8f-3984-445c-a4cb-e4d2e1aa0fce';
const DLL = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(254, 0x90)]);
const SHA256 = createHash('sha256').update(DLL).digest('hex');

const hasPython = (() => {
	try {
		execFileSync('python3', ['--version']);
		return true;
	} catch {
		return false;
	}
})();

/** The layout build.sh and the repository leave behind, in the shape the real ones have. */
function pluginRepo(recordedSha = SHA256): string {
	const root = mkdtempSync(path.join(tmpdir(), 'emby-plugin-repo-'));
	const project = path.join(root, 'src', 'Emby.Plugin.RdZurg');
	mkdirSync(project, { recursive: true });
	writeFileSync(
		path.join(project, 'Emby.Plugin.RdZurg.csproj'),
		'<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <Version>1.0.3.0</Version>\n  </PropertyGroup>\n</Project>\n'
	);
	writeFileSync(
		path.join(project, 'Plugin.cs'),
		[
			'public class Plugin : BasePluginSimpleUI<PluginOptions>, IHasThumbImage',
			'{',
			'    public const string PluginName = "RD zurg";',
			'    public override string Name => PluginName;',
			'    public override string Description => "Your Real-Debrid library in Emby, without a mount.";',
			`    public override Guid Id => new("${GUID}");`,
			'}',
		].join('\n')
	);
	writeFileSync(
		path.join(root, 'CHANGELOG.md'),
		'# Changelog\n\n## 1.0.3.0 - 2026-09-23\n\n- Signed playback URLs.\n\n## 1.0.2.0 - 2026-09-20\n\n- Older.\n'
	);
	const pkg = path.join(root, 'artifacts', 'rd-zurg-for-emby_1.0.3.0');
	mkdirSync(pkg, { recursive: true });
	writeFileSync(path.join(pkg, 'Emby.Plugin.RdZurg.dll'), DLL);
	writeFileSync(
		path.join(pkg, 'Emby.Plugin.RdZurg.dll.sha256'),
		`${recordedSha}  Emby.Plugin.RdZurg.dll\n`
	);
	return root;
}

let server: http.Server;
let base = '';
let received = 0;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', async () => {
			received++;
			const mock = createMockResponse();
			await handler(
				createMockRequest({
					method: req.method,
					url: req.url,
					headers: req.headers as Record<string, string>,
					body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
				}),
				mock
			);
			res.writeHead(mock._getStatusCode(), { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(mock._getData()));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
	vi.clearAllMocks();
	received = 0;
	process.env.PLUGIN_PUBLISH_SECRET = SECRET;
	process.env.REDIS_URL = 'redis://catalog-lock.test';
	redisState.values.clear();
	mockPut.mockResolvedValue(true);
	mockGet.mockResolvedValue(null);
});

function run(repo: string, token = SECRET): Promise<{ code: number; out: string }> {
	return new Promise((resolve) => {
		execFile(
			'python3',
			[SCRIPT, repo],
			{ env: { ...process.env, DMM_PUBLISH_URL: base, DMM_PUBLISH_TOKEN: token } },
			(error, stdout, stderr) =>
				resolve({
					code: error ? ((error as { code?: number }).code ?? 1) : 0,
					out: stdout + stderr,
				})
		);
	});
}

describe.skipIf(!hasPython)('the release job publish script', () => {
	it('publishes a built plugin the endpoint accepts, with its changelog', async () => {
		const repo = pluginRepo();
		try {
			const { code, out } = await run(repo);
			expect(out).toContain('200');
			expect(code).toBe(0);

			const written = JSON.parse(
				(
					mockPut.mock.calls.find(
						(c) => c[0] === 'emby-plugins/catalog.json'
					)![1] as Buffer
				).toString()
			) as EmbyPublishedPlugin[];
			expect(written).toHaveLength(1);
			expect(written[0]).toMatchObject({
				guid: GUID,
				name: 'RD zurg',
				description: 'Your Real-Debrid library in Emby, without a mount.',
				assembly: 'Emby.Plugin.RdZurg.dll',
				version: '1.0.3.0',
				changelog: '- Signed playback URLs.',
				sha256: SHA256,
				size: DLL.length,
			});
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('refuses to send a DLL that does not match the sha256 build.sh wrote', async () => {
		const repo = pluginRepo('f'.repeat(64));
		try {
			const { code, out } = await run(repo);
			expect(code).toBe(1);
			expect(out).toContain('does not match');
			expect(received).toBe(0);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('fails the job when the endpoint refuses the token', async () => {
		const repo = pluginRepo();
		try {
			const { code, out } = await run(repo, 'wrong');
			expect(code).toBe(1);
			expect(out).toContain('HTTP 401');
			expect(mockPut).not.toHaveBeenCalled();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
