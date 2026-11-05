// @vitest-environment node
import ingest from '@/pages/api/availability/ad';
import play from '@/pages/api/stremio-ad/[userid]/play/[hash]';
import { AllDebridCastService } from '@/services/database/allDebridCast';
import { AvailabilityService } from '@/services/database/availability';
import recorded from '@/test/fixtures/allDebridAvailable/regressed-magnet-2026-11-05.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { submitAvailabilityAd } from '@/utils/availability';
import { classifyAllDebridPlayError } from '@/utils/castAddonFailure';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const prisma = {
		availableAd: { updateMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
		availableAdFile: { deleteMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
		allDebridCast: { deleteMany: vi.fn() },
		$transaction: vi.fn(async (work: Promise<unknown>[]) => Promise.all(work)),
	};
	return {
		prisma,
		db: {
			upsertAvailabilityAd: vi.fn(),
			getAllDebridCastProfile: vi.fn(),
			getAllDebridCastLink: vi.fn(),
			removeDeadAllDebridLink: vi.fn(),
		},
		unlockLink: vi.fn(),
		getAllDebridUser: vi.fn(),
		getMagnetFiles: vi.fn(),
	};
});
vi.mock('@/services/database/client', () => ({
	DatabaseClient: class {
		prisma = mocks.prisma;
	},
}));
vi.mock('@/services/repository', () => ({ repository: mocks.db }));
vi.mock('@/utils/problemToken', () => ({ validateProblemToken: () => true }));
vi.mock('@/services/allDebrid', () => ({
	unlockLink: mocks.unlockLink,
	getAllDebridUser: mocks.getAllDebridUser,
	getMagnetFiles: mocks.getMagnetFiles,
}));

const magnet = recorded.ad_magnet_status_regressed.body.data.magnets;
const data = {
	...magnet,
	imdbId: 'tt1234567',
	files: recorded.ad_magnet_files_regressed.body.data.magnets[0].files,
};
const link = `https://alldebrid.com/f/${'b'.repeat(43)}`;
const dead = () =>
	Object.assign(new Error(recorded.ad_unlock_dead_token.body.error.message), {
		code: recorded.ad_unlock_dead_token.body.error.code,
	});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.prisma.availableAd.updateMany.mockResolvedValue({ count: 1 });
	mocks.prisma.availableAdFile.deleteMany.mockResolvedValue({ count: 1 });
	mocks.prisma.availableAdFile.findFirst.mockResolvedValue({ hash: magnet.hash });
	// the dead file was the release's last
	mocks.prisma.availableAdFile.count.mockResolvedValue(0);
	mocks.prisma.availableAd.deleteMany.mockResolvedValue({ count: 1 });
	mocks.prisma.allDebridCast.deleteMany.mockResolvedValue({ count: 1 });
	mocks.db.getAllDebridCastProfile.mockResolvedValue({ apiKey: 'synthetic-key' });
	mocks.db.getAllDebridCastLink.mockResolvedValue(link);
	mocks.db.removeDeadAllDebridLink.mockImplementation((value: string) =>
		new AllDebridCastService().removeDeadLink(value)
	);
	mocks.unlockLink.mockRejectedValue(dead());
	mocks.getMagnetFiles.mockResolvedValue({ magnets: [{ id: String(magnet.id), files: [] }] });
	mocks.getAllDebridUser.mockResolvedValue({ isPremium: true });
});

describe('recorded AllDebrid cache regression', () => {
	it('submits a successful Downloading observation instead of keeping Ready forever', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
		try {
			await submitAvailabilityAd('problem', 'solution', data);
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/availability/ad',
				expect.objectContaining({ body: expect.stringContaining('Downloading') })
			);
		} finally {
			fetchMock.mockRestore();
		}
	});
	it('accepts the authenticated regressed observation with an empty file list', async () => {
		const res = createMockResponse();
		await ingest(
			createMockRequest({
				method: 'POST',
				body: { ...data, dmmProblemKey: 'problem', solution: 'solution' },
			}),
			res
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mocks.db.upsertAvailabilityAd).toHaveBeenCalledWith(
			expect.objectContaining({ statusCode: 1, files: [] })
		);
	});
	it('demotes by hash on a hash-list page without IMDb or completed metadata', async () => {
		const res = createMockResponse();
		await ingest(
			createMockRequest({
				method: 'POST',
				body: {
					hash: magnet.hash,
					status: magnet.status,
					statusCode: magnet.statusCode,
					files: [],
					dmmProblemKey: 'problem',
					solution: 'solution',
				},
			}),
			res
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mocks.db.upsertAvailabilityAd).toHaveBeenCalledWith(
			expect.objectContaining({ hash: magnet.hash, statusCode: 1 })
		);
	});
	it('demotes existing rows and removes their obsolete tokens without creating uncached rows', async () => {
		await new AvailabilityService().upsertAvailabilityAd(data);
		expect(mocks.prisma.availableAd.updateMany).toHaveBeenCalledWith({
			where: { hash: magnet.hash },
			data: { status: 'Downloading', statusCode: 1 },
		});
		expect(mocks.prisma.availableAdFile.deleteMany).toHaveBeenCalledWith({
			where: { hash: magnet.hash },
		});
		expect(mocks.prisma.availableAd.upsert).not.toHaveBeenCalled();
	});
});

describe('AllDebrid dead token cleanup', () => {
	const request = async (hash = `${magnet.id}:0`) => {
		const res = createMockResponse();
		await play(createMockRequest({ query: { userid: 'synthetic-user', hash } }), res);
		return res;
	};
	it.each(['LINK_HOST_NOT_SUPPORTED', 'LINK_DOWN'])(
		'invalidates a %s token after confirming viewer premium',
		async (code) => {
			mocks.unlockLink.mockRejectedValue(Object.assign(dead(), { code }));
			await request();
			expect(mocks.db.removeDeadAllDebridLink).toHaveBeenCalledWith(link);
			expect(mocks.prisma.availableAdFile.deleteMany).toHaveBeenCalledWith({
				where: { link },
			});
			expect(mocks.prisma.allDebridCast.deleteMany).toHaveBeenCalledWith({ where: { link } });
			// with no file left the release serves nothing, so it stops reading as cached
			expect(mocks.prisma.availableAd.deleteMany).toHaveBeenCalledWith({
				where: { hash: magnet.hash },
			});
		}
	);
	it('invalidates a saved /f/ token without consulting a magnet', async () => {
		await request(`l${Buffer.from(link).toString('base64url')}:0`);
		expect(mocks.db.removeDeadAllDebridLink).toHaveBeenCalledWith(link);
	});
	it.each([false, undefined])('keeps shared tokens when premium is %s', async (isPremium) => {
		mocks.getAllDebridUser.mockResolvedValue({ isPremium });
		await request();
		expect(mocks.db.removeDeadAllDebridLink).not.toHaveBeenCalled();
	});
	it('keeps shared tokens when premium confirmation fails', async () => {
		mocks.getAllDebridUser.mockRejectedValue(
			Object.assign(new Error('confirm email'), { code: 'AUTH_BLOCKED' })
		);
		await request();
		expect(mocks.db.removeDeadAllDebridLink).not.toHaveBeenCalled();
	});
	it.each([
		'AUTH_BLOCKED',
		'MUST_BE_PREMIUM',
		'LINK_HOST_UNAVAILABLE',
		'LINK_PASS_PROTECTED',
		'BAD_LINK',
	])('does not invalidate for %s', async (code) => {
		mocks.unlockLink.mockRejectedValue(Object.assign(new Error(code), { code }));
		await request();
		expect(mocks.db.removeDeadAllDebridLink).not.toHaveBeenCalled();
	});
	it('preserves maintenance as transient, not a dead token', () => {
		expect(classifyAllDebridPlayError({ code: 'LINK_HOST_UNAVAILABLE' })).toBe('unavailable');
	});
});
