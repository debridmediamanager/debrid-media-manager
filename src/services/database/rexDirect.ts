import { randomBytes } from 'crypto';
import { DatabaseClient } from './client';

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
	 * The stored hash for a machine, assigning one on first sight. The owning
	 * sponsorship is recorded so a name can be traced back, and refreshed on
	 * every call in case the server moved to another sponsor's key.
	 */
	public async getOrAssignHash(
		machineIdentifier: string,
		shortId: string
	): Promise<RexDirectRegistration> {
		const existing = await this.prisma.rexDirectName.findUnique({
			where: { machineIdentifier },
			select: { hash: true },
		});
		if (existing) {
			await this.prisma.rexDirectName.update({
				where: { machineIdentifier },
				data: { shortId },
			});
			return { hash: existing.hash, created: false };
		}

		// 128 bits of randomness; a collision is infeasible, but the unique index
		// is the backstop and a clash just retries with a fresh value.
		for (let attempt = 0; attempt < 5; attempt++) {
			const hash = randomBytes(16).toString('hex');
			try {
				await this.prisma.rexDirectName.create({
					data: { machineIdentifier, hash, shortId },
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
