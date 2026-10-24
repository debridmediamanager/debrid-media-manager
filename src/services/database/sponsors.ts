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
	discordStaff: boolean;
};

const SELECT = {
	shortId: true,
	githubUsername: true,
	dmmApiKeyVersion: true,
	githubSponsoring: true,
	patreonAmount: true,
	oneTimeDonationEndDate: true,
	discordStaff: true,
} as const;

/**
 * gatekeeper's active-sponsorship test, which it spells out identically in
 * sponsorship-perks.ts, sponsorship.service.ts and sponsorship-data.ts. If it
 * changes there it has to change here too.
 */
function activeSources(sponsor: SponsorRow, earnedUntil: Date | null): SponsorSource[] {
	const sources: SponsorSource[] = [];
	if (sponsor.githubSponsoring) sources.push('github');
	if (sponsor.patreonAmount > 0) sources.push('patreon');
	if (sponsor.oneTimeDonationEndDate && sponsor.oneTimeDonationEndDate > new Date()) {
		sources.push('onetime');
	}
	// A Discord admin or moderator, flagged by gatekeeper's sync from the guild roles.
	if (sponsor.discordStaff) sources.push('staff');
	// DMM's own: sponsor time paid for by fulfilling requests. gatekeeper never
	// sees it, so it opens DMM's perks and none of gatekeeper's.
	if (earnedUntil && earnedUntil > new Date()) sources.push('earned');
	return sources;
}

function toLookup(sponsor: SponsorRow, earnedUntil: Date | null): SponsorLookup {
	const sources = activeSources(sponsor, earnedUntil);
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
	 * A failed read of earned time costs only earned time: every sponsor check
	 * passes through here, and paying sponsors must not lose access over it.
	 */
	private async withEarned(sponsor: SponsorRow): Promise<SponsorLookup> {
		let earnedUntil: Date | null = null;
		try {
			const earned = await this.prisma.sponsorEarned.findUnique({
				where: { shortId: sponsor.shortId },
				select: { earnedUntil: true },
			});
			earnedUntil = earned?.earnedUntil ?? null;
		} catch (error) {
			console.error('Reading earned sponsor time failed:', error);
		}
		return toLookup(sponsor, earnedUntil);
	}

	/** GitHub names for these sponsorships, for the opted-in leaderboard. */
	public async githubNames(shortIds: string[]): Promise<Map<string, string>> {
		if (shortIds.length === 0) return new Map();
		const rows = await this.prisma.sponsors.findMany({
			where: { shortId: { in: shortIds } },
			select: { shortId: true, githubUsername: true },
		});
		return new Map(rows.map((r) => [r.shortId, r.githubUsername]));
	}

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

		return sponsor ? this.withEarned(sponsor) : null;
	}

	/**
	 * The key gatekeeper issued before `dmmApiKey`, kept in `Sponsors.zurgApiKey`, for a
	 * sponsor who has not been issued a `dmmApiKey` since. A sponsor who has one gets no
	 * fallback: their old key may be the very one they reset.
	 *
	 * The same keys sit in the `ZurgKeys` table with no expiry and no link to a sponsorship,
	 * which is why reading that table let 292 lapsed sponsors keep `/api/zurg/hashes-by-imdb`.
	 */
	public async getByLegacyZurgKey(apiKey: string): Promise<SponsorLookup | null> {
		if (!apiKey) return null;

		const sponsor = await this.prisma.sponsors.findFirst({
			where: { zurgApiKey: apiKey, dmmApiKey: null },
			select: SELECT,
		});

		return sponsor ? this.withEarned(sponsor) : null;
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

		return sponsor ? this.withEarned(sponsor) : null;
	}

	/**
	 * The Sponsorship ID that let a cast profile store an "other streams" limit
	 * above the standard one. Unlike `Sponsors`, `CastSponsorGrant` is dmm's own.
	 */
	public async getCastGrant(service: string, userId: string): Promise<string | null> {
		const grant = await this.prisma.castSponsorGrant.findUnique({
			where: { service_userId: { service, userId } },
			select: { shortId: true },
		});
		return grant?.shortId ?? null;
	}

	/** Records which sponsorship allowed the limit; null removes the grant. */
	public async setCastGrant(
		service: string,
		userId: string,
		shortId: string | null
	): Promise<void> {
		if (shortId) {
			await this.prisma.castSponsorGrant.upsert({
				where: { service_userId: { service, userId } },
				create: { service, userId, shortId },
				update: { shortId },
			});
		} else {
			await this.prisma.castSponsorGrant.deleteMany({ where: { service, userId } });
		}
	}
}
