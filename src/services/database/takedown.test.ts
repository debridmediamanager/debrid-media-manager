import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TakedownService } from './takedown';

// An in-memory stand-in for the three tables, enough to exercise ownership.
const db = vi.hoisted(() => ({
	notices: new Map<string, any>(),
	hashes: new Map<string, string>(),
	releases: new Map<string, string>(),
}));

const prismaMock = vi.hoisted(() => {
	const table = (key: 'hashes' | 'releases', col: 'hash' | 'name') => ({
		createMany: vi.fn(async ({ data, skipDuplicates }: any) => {
			for (const row of data) {
				if (db[key].has(row[col])) {
					if (!skipDuplicates) throw new Error(`duplicate ${row[col]}`);
					continue;
				}
				db[key].set(row[col], row.noticeId);
			}
		}),
		deleteMany: vi.fn(async ({ where }: any) => {
			for (const [k, owner] of db[key]) if (owner === where.noticeId) db[key].delete(k);
		}),
		findMany: vi.fn(async ({ where }: any = {}) =>
			[...db[key]]
				.filter(([, owner]) => !where || owner === where.noticeId)
				.map(([k, noticeId]) => ({ [col]: k, noticeId }))
		),
	});
	const mock: any = {
		takedownNotice: {
			findUnique: vi.fn(async ({ where }: any) => db.notices.get(where.id) ?? null),
			findMany: vi.fn(async ({ where }: any) =>
				[...db.notices.values()].filter(
					(n) => n.status === where.status && n.id !== where.id.not
				)
			),
			update: vi.fn(async ({ where, data }: any) => {
				const next = { ...db.notices.get(where.id), ...data };
				db.notices.set(where.id, next);
				return next;
			}),
		},
		blockedHash: table('hashes', 'hash'),
		blockedRelease: table('releases', 'name'),
	};
	mock.$transaction = vi.fn(async (fn: any) => fn(mock));
	return mock;
});

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const notice = (id: string, hashes: string[], releases: string[] = []) =>
	db.notices.set(id, {
		id,
		status: 'pending',
		hashes,
		releases,
		hashlistIds: [],
		reviewedAt: null,
	});

describe('TakedownService', () => {
	let service: TakedownService;

	beforeEach(() => {
		db.notices.clear();
		db.hashes.clear();
		db.releases.clear();
		service = new TakedownService();
	});

	it('blocks nothing until a notice is approved', async () => {
		notice('n1', [A], ['big.buck.bunny']);
		expect(await service.getBlocked()).toEqual({ hashes: [], releases: [] });
		await service.approveNotice('n1', null);
		expect(await service.getBlocked()).toEqual({ hashes: [A], releases: ['big.buck.bunny'] });
		expect(db.notices.get('n1').status).toBe('approved');
	});

	it('rejecting a pending notice blocks nothing', async () => {
		notice('n1', [A]);
		await service.rejectNotice('n1', 'not the claimant’s work');
		expect(db.hashes.size).toBe(0);
		expect(db.notices.get('n1')).toMatchObject({
			status: 'rejected',
			reviewNote: 'not the claimant’s work',
		});
	});

	// Two notices naming the same hash: reversing the first must not unblock
	// what the second still covers.
	it('reversing one of two overlapping approvals keeps the shared hash blocked', async () => {
		notice('n1', [A, B]);
		notice('n2', [A]);
		await service.approveNotice('n1', null);
		await service.approveNotice('n2', null);
		expect(db.hashes.get(A)).toBe('n1');

		await service.rejectNotice('n1', null);

		expect(db.hashes.get(A)).toBe('n2');
		expect(db.hashes.has(B)).toBe(false);
	});

	it('approving twice is harmless', async () => {
		notice('n1', [A]);
		await service.approveNotice('n1', null);
		await service.approveNotice('n1', null);
		expect([...db.hashes.keys()]).toEqual([A]);
	});
});
