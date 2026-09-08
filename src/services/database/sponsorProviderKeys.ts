import {
	maskProviderKey,
	TORZNAB_LIVE_SERVICES,
	TorznabLiveService,
} from '@/utils/sponsorProviders';
import { DatabaseClient } from './client';

export interface LinkedProviderKey {
	service: TorznabLiveService;
	/** Masked. The raw key never leaves this service except to the provider. */
	hint: string;
	updatedAt: Date;
}

/**
 * A sponsor's own TorBox / Premiumize / Offcloud key, for the Torznab feed's
 * availability filters.
 *
 * `Sponsors` is gatekeeper's table and dmm only reads it, so this is a separate
 * table dmm owns. It is keyed on the gatekeeper `shortId` rather than on the DMM
 * API key: a Reset API Key in gatekeeper changes the key but not the identity,
 * and detaching every linked provider on a key reset would be a surprise nobody
 * asked for.
 */
export class SponsorProviderKeysService extends DatabaseClient {
	/** The raw key, for a live cache probe. Never return this to a client. */
	public async getKey(shortId: string, service: TorznabLiveService): Promise<string | null> {
		if (!shortId) return null;
		const row = await this.prisma.sponsorProviderKey.findUnique({
			where: { shortId_service: { shortId, service } },
			select: { apiKey: true },
		});
		return row?.apiKey ?? null;
	}

	/** What this sponsor has linked, masked, for the settings panel. */
	public async listLinked(shortId: string): Promise<LinkedProviderKey[]> {
		if (!shortId) return [];
		const rows = await this.prisma.sponsorProviderKey.findMany({
			where: { shortId },
			select: { service: true, apiKey: true, updatedAt: true },
		});

		// A row whose service is no longer one this build offers is ignored rather
		// than surfaced: the panel has no label for it and no way to unlink it.
		return rows
			.filter((row): row is typeof row & { service: TorznabLiveService } =>
				(TORZNAB_LIVE_SERVICES as readonly string[]).includes(row.service)
			)
			.map((row) => ({
				service: row.service,
				hint: maskProviderKey(row.apiKey),
				updatedAt: row.updatedAt,
			}))
			.sort((a, b) => a.service.localeCompare(b.service));
	}

	public async setKey(
		shortId: string,
		service: TorznabLiveService,
		apiKey: string
	): Promise<void> {
		await this.prisma.sponsorProviderKey.upsert({
			where: { shortId_service: { shortId, service } },
			update: { apiKey },
			create: { shortId, service, apiKey },
		});
	}

	/** False when there was nothing linked, which is not an error. */
	public async removeKey(shortId: string, service: TorznabLiveService): Promise<boolean> {
		const result = await this.prisma.sponsorProviderKey.deleteMany({
			where: { shortId, service },
		});
		return result.count > 0;
	}
}
