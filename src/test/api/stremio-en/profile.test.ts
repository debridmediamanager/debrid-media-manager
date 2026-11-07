import catalogMovies from '@/pages/api/stremio-en/[userid]/catalog/movie/en-casted-movies.json';
import manifestHandler, {
	easynewsCastManifest,
} from '@/pages/api/stremio-en/[userid]/manifest.json';
import metaHandler from '@/pages/api/stremio-en/[userid]/meta/other/[id]';
import noCatalogManifest from '@/pages/api/stremio-en/[userid]/no-catalog/manifest.json';
import saveProfile from '@/pages/api/stremio-en/cast/saveProfile';
import updateSizeLimits from '@/pages/api/stremio-en/cast/updateSizeLimits';
import deleteLink from '@/pages/api/stremio-en/deletelink';
import idHandler from '@/pages/api/stremio-en/id';
import links from '@/pages/api/stremio-en/links';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { resolveEasynewsUser } from '@/utils/easynewsCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/easynewsCastApiHelpers', () => ({ resolveEasynewsUser: vi.fn() }));
vi.mock('@/utils/castCatalogMeta', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/castCatalogMeta')>()),
	buildCatalogMetas: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))),
}));
vi.mock('@/utils/requireSponsor', () => ({ sponsorIdOfRequest: vi.fn(async () => null) }));

const mockRepository = vi.mocked(repository);
const mockResolve = vi.mocked(resolveEasynewsUser);
const post = (body: object, method = 'POST') => createMockRequest({ method, body });

describe('/api/stremio-en profile, links and addon routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolve.mockResolvedValue({ valid: true, userId: 'en-user' });
		mockRepository.saveEasynewsCastProfile = vi.fn().mockResolvedValue({
			userId: 'en-user',
			apiKey: 'secret',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
		});
		mockRepository.setCastSponsorGrant = vi.fn().mockResolvedValue(undefined);
	});

	it('saves a profile and never echoes the login back', async () => {
		const res = createMockResponse();
		await saveProfile(post({ apiKey: 'secret', otherStreamsLimit: 5 }), res);
		expect(res._getStatusCode()).toBe(200);
		expect(mockRepository.saveEasynewsCastProfile).toHaveBeenCalledWith(
			'en-user',
			'secret',
			undefined,
			undefined,
			5,
			undefined
		);
		expect(JSON.stringify(res._getData())).not.toContain('secret');
	});

	it('refuses a login Easynews rejects, and a raised limit for a non-sponsor', async () => {
		mockResolve.mockResolvedValue({ valid: false });
		const refused = createMockResponse();
		await saveProfile(post({ apiKey: 'wrong' }), refused);
		expect(refused._getStatusCode()).toBe(401);

		const tooMany = createMockResponse();
		await saveProfile(post({ apiKey: 'secret', otherStreamsLimit: 10 }), tooMany);
		expect(tooMany._getStatusCode()).toBe(400);
	});

	it('updates settings by cast id alone, and answers 404 for an unknown one', async () => {
		mockRepository.updateEasynewsCastSettings = vi.fn().mockResolvedValue(true);
		const ok = createMockResponse();
		await updateSizeLimits(post({ userId: 'en-user', movieMaxSize: 15 }), ok);
		expect(ok._getStatusCode()).toBe(200);
		expect(mockResolve).not.toHaveBeenCalled();

		mockRepository.updateEasynewsCastSettings = vi.fn().mockResolvedValue(false);
		const missing = createMockResponse();
		await updateSizeLimits(post({ userId: 'nobody', movieMaxSize: 15 }), missing);
		expect(missing._getStatusCode()).toBe(404);
	});

	it('lists and deletes the member’s casts under the id their login resolves to', async () => {
		mockRepository.fetchAllEasynewsCastedLinks = vi
			.fn()
			.mockResolvedValue([{ imdbId: 'tt1', hash: 'h', url: 'x.mkv', size: 1 }]);
		const listed = createMockResponse();
		await links(post({ apiKey: 'secret' }), listed);
		expect(mockRepository.fetchAllEasynewsCastedLinks).toHaveBeenCalledWith('en-user');
		expect((listed._getData() as any).links).toHaveLength(1);

		mockRepository.deleteEasynewsCastedLink = vi.fn().mockResolvedValue(true);
		const deleted = createMockResponse();
		await deleteLink(post({ apiKey: 'secret', imdbId: 'tt1', hash: 'h' }, 'DELETE'), deleted);
		expect(deleted._getStatusCode()).toBe(200);
		expect(mockRepository.deleteEasynewsCastedLink).toHaveBeenCalledWith('tt1', 'en-user', 'h');
	});

	it('answers the cast id for a login', async () => {
		const res = createMockResponse();
		await idHandler(post({ apiKey: 'secret' }), res);
		expect(res._getData()).toEqual({ id: 'en-user' });
	});

	it('publishes movie and show catalogs and a no-catalog variant under one version', async () => {
		const full = createMockResponse();
		await manifestHandler(createMockRequest(), full);
		const bare = createMockResponse();
		await noCatalogManifest(createMockRequest(), bare);
		const manifest = full._getData() as ReturnType<typeof easynewsCastManifest>;
		expect(manifest.catalogs.map((c) => c.id)).toEqual(['en-casted-movies', 'en-casted-shows']);
		expect((bare._getData() as any).catalogs).toEqual([]);
		expect((bare._getData() as any).version).toBe(manifest.version);
	});

	it('serves the member’s casted movies as a catalog', async () => {
		mockRepository.fetchEasynewsCastedMovies = vi.fn().mockResolvedValue(['tt14141770']);
		const res = createMockResponse();
		await catalogMovies(createMockRequest({ query: { userid: 'en-user' } }), res);
		expect((res._getData() as any).metas).toEqual([{ id: 'tt14141770' }]);
	});

	it('answers its own notice tiles and nothing else', async () => {
		const notice = createMockResponse();
		await metaHandler(
			createMockRequest({ query: { userid: 'u', id: 'dmm-en:notice:credential.json' } }),
			notice
		);
		expect((notice._getData() as any).meta.name).toContain('Easynews');

		const foreign = createMockResponse();
		await metaHandler(createMockRequest({ query: { userid: 'u', id: 'dmm-pm:123' } }), foreign);
		expect(foreign._getStatusCode()).toBe(404);
	});
});
