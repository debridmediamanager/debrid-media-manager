import { randomBytes } from 'crypto';
import { DatabaseClient } from './client';

export type RexDirectOwner = { plexAccountId: string } | { shortId: string };

export interface RexDirectRegistration {
	hash: string;
	/** True the first time this server was seen, for logging. */
	created: boolean;
}

/**
 * A rex server's own `<hash>.rex-direct.debridmediamanager.com` name and the
 * shared wildcard cert that covers it (`src/pages/api/rex-direct`).
 *
 * The hash is a random 128-bit value assigned once and stored, keyed by the
 * server's machineIdentifier. It is deliberately NOT derived from the
 * machineIdentifier: that id is handed out unauthenticated by `/identity` and
 * GDM, so a derivable hash would let anyone turn a server's id into its hostname
 * and resolve its home IP. Random-and-stored is what plex.direct does, for the
 * same reason.
 */
export class RexDirectService extends DatabaseClient {
	/**
	 * The stored hash for a machine, assigning one on first sight. The owner (a
	 * Plex account, or a sponsorship on the old sponsor-key path) is recorded so a
	 * name can be traced back, and refreshed on every call in case it moved.
	 */
	public async getOrAssignHash(
		machineIdentifier: string,
		owner: RexDirectOwner
	): Promise<RexDirectRegistration> {
		const existing = await this.prisma.rexDirectName.findUnique({
			where: { machineIdentifier },
			select: { hash: true },
		});
		if (existing) {
			await this.prisma.rexDirectName.update({
				where: { machineIdentifier },
				data: owner,
			});
			return { hash: existing.hash, created: false };
		}

		// 128 bits of randomness; a collision is infeasible, but the unique index
		// is the backstop and a clash just retries with a fresh value.
		for (let attempt = 0; attempt < 5; attempt++) {
			const hash = randomBytes(16).toString('hex');
			try {
				await this.prisma.rexDirectName.create({
					data: { machineIdentifier, hash, ...owner },
				});
				return { hash, created: true };
			} catch (error) {
				// A race on the same machineIdentifier (two heartbeats at once) means
				// the row now exists: read it back rather than failing.
				const row = await this.prisma.rexDirectName.findUnique({
					where: { machineIdentifier },
					select: { hash: true },
				});
				if (row) return { hash: row.hash, created: false };
				// Otherwise a hash collision (unique index): loop with a new value.
			}
		}
		throw new Error('rex-direct: could not assign a unique hash');
	}

	/** The IP the A record was last set to, so an unchanged heartbeat skips the DNS write. */
	public async lastIp(machineIdentifier: string): Promise<string | null> {
		const row = await this.prisma.rexDirectName.findUnique({
			where: { machineIdentifier },
			select: { lastIp: true },
		});
		return row?.lastIp ?? null;
	}

	public async recordIp(machineIdentifier: string, ip: string): Promise<void> {
		await this.prisma.rexDirectName.update({
			where: { machineIdentifier },
			data: { lastIp: ip },
		});
	}

	/** Whether this machine already has a name: a new one counts against its account's cap. */
	public async exists(machineIdentifier: string): Promise<boolean> {
		return (await this.prisma.rexDirectName.count({ where: { machineIdentifier } })) > 0;
	}

	public async countByPlexAccount(plexAccountId: string): Promise<number> {
		return this.prisma.rexDirectName.count({ where: { plexAccountId } });
	}

	public async serverCert(
		machineIdentifier: string
	): Promise<{ certificate: string; privateKey: string; expiresAt: Date } | null> {
		const row = await this.prisma.rexDirectName.findUnique({
			where: { machineIdentifier },
			select: { certificate: true, privateKey: true, certExpiresAt: true },
		});
		if (!row?.certificate || !row.privateKey || !row.certExpiresAt) return null;
		return {
			certificate: row.certificate,
			privateKey: row.privateKey,
			expiresAt: row.certExpiresAt,
		};
	}

	/**
	 * Take the right to order this machine's certificate: true for exactly one
	 * caller until it stores or releases it, or until the hold is 15 minutes old.
	 */
	public async startIssuing(machineIdentifier: string): Promise<boolean> {
		const stale = new Date(Date.now() - 15 * 60_000);
		const { count } = await this.prisma.rexDirectName.updateMany({
			where: {
				machineIdentifier,
				OR: [{ issuingSince: null }, { issuingSince: { lt: stale } }],
			},
			data: { issuingSince: new Date() },
		});
		return count === 1;
	}

	public async storeServerCert(
		machineIdentifier: string,
		certificate: string,
		privateKey: string,
		expiresAt: Date
	): Promise<void> {
		await this.prisma.rexDirectName.update({
			where: { machineIdentifier },
			data: { certificate, privateKey, certExpiresAt: expiresAt, issuingSince: null },
		});
	}

	/**
	 * After a failed order, keep the hold for 30 minutes instead of releasing it:
	 * rex asks again every minute while it waits, and releasing at once started a
	 * fresh ZeroSSL order on each of those calls (2026-10-19). The hold goes stale
	 * 15 minutes after `issuingSince`, so dating it 15 minutes ahead gives 30.
	 */
	public async backOffIssuing(machineIdentifier: string): Promise<void> {
		await this.prisma.rexDirectName.update({
			where: { machineIdentifier },
			data: { issuingSince: new Date(Date.now() + 15 * 60_000) },
		});
	}

	/** The current wildcard cert, or null before the renewal cron has stored one. */
	public async getCert(): Promise<{ fullchain: string; privkey: string } | null> {
		const row = await this.prisma.rexDirectCert.findUnique({
			where: { id: 'current' },
			select: { fullchain: true, privkey: true },
		});
		return row ?? null;
	}

	public async setCert(fullchain: string, privkey: string): Promise<void> {
		await this.prisma.rexDirectCert.upsert({
			where: { id: 'current' },
			update: { fullchain, privkey },
			create: { id: 'current', fullchain, privkey },
		});
	}
}
