import { SponsorSource } from '@/utils/sponsorToken';
import { DatabaseClient } from './client';

export interface SponsorLookup {
	/** True when at least one sponsorship source is currently active. */
	isSponsor: boolean;
	sources: SponsorSource[];
	/** gatekeeper's 4-character Sponsorship ID. */
	shortId: string;
	githubUsername: string;
	/** Bumped by gatekeeper's Reset API Key button, which is how a key is revoked. */
	keyVersion: number;
}

type SponsorRow = {
	shortId: string;
	githubUsername: string;
	dmmApiKeyVersion: number;
	githubSponsoring: boolean;
	patreonAmount: number;
	oneTimeDonationEndDate: Date | null;
};

const SELECT = {
	shortId: true,
	githubUsername: true,
	dmmApiKeyVersion: true,
	githubSponsoring: true,
	patreonAmount: true,
	oneTimeDonationEndDate: true,
} as const;

/**
 * gatekeeper's active-sponsorship test, which it spells out identically in
 * sponsorship-perks.ts, sponsorship.service.ts and sponsorship-data.ts. If it
 * changes there it has to change here too.
 */
function activeSources(sponsor: SponsorRow): SponsorSource[] {
	const sources: SponsorSource[] = [];
	if (sponsor.githubSponsoring) sources.push('github');
	if (sponsor.patreonAmount > 0) sources.push('patreon');
	if (sponsor.oneTimeDonationEndDate && sponsor.oneTimeDonationEndDate > new Date()) {
		sources.push('onetime');
	}
	return sources;
}

function toLookup(sponsor: SponsorRow): SponsorLookup {
	const sources = activeSources(sponsor);
	return {
		isSponsor: sources.length > 0,
		sources,
		shortId: sponsor.shortId,
		githubUsername: sponsor.githubUsername,
		keyVersion: sponsor.dmmApiKeyVersion,
	};
}

export class SponsorsService extends DatabaseClient {
	/**
	 * Resolves the sponsorship behind a DMM API key.
	 *
	 * `Sponsors` is gatekeeper's table, shared through dmmdb - dmm only ever
	 * reads it. Deliberately keyed on `Sponsors.dmmApiKey` rather than the
	 * `DmmApiKeys` table: that table is a bare list of key strings with no link
	 * back to a sponsor and no expiry, so it can say a key was once issued but
	 * never that the sponsorship behind it is still live.
	 */
	public async getByDmmApiKey(apiKey: string): Promise<SponsorLookup | null> {
		// The column is a 64-char sha256 hex digest; anything else cannot match,
		// and rejecting it here keeps junk off the index.
		if (!apiKey || !/^[0-9a-f]{64}$/.test(apiKey)) return null;

		const sponsor = await this.prisma.sponsors.findUnique({
			where: { dmmApiKey: apiKey },
			select: SELECT,
		});

		return sponsor ? toLookup(sponsor) : null;
	}

	/**
	 * Re-checks a sponsorship by Sponsorship ID, for refreshing a token without
	 * the client having to hand back the key itself.
	 */
	public async getByShortId(shortId: string): Promise<SponsorLookup | null> {
		if (!shortId) return null;

		const sponsor = await this.prisma.sponsors.findUnique({
			where: { shortId },
			select: SELECT,
		});

		return sponsor ? toLookup(sponsor) : null;
	}
}
