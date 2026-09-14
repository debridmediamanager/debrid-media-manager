import type { SponsorLookup } from '@/services/database';
import { repository } from '@/services/repository';
import { signSponsorToken, type SponsorSource } from '@/utils/sponsorToken';
import { vi } from 'vitest';

export const TEST_SPONSOR_SHORT_ID = 'ZP1M';

/**
 * A sponsor token plus the live row behind it.
 *
 * Both halves are needed together: the gates in `utils/requireSponsor.ts` verify
 * the signature and then re-read the sponsorship, so a test that mints a token
 * without seeding the row is testing a sponsor whose pledge has ended. Callers
 * that want that case should say so with `sponsorshipLapsed()` instead.
 *
 * Requires `vi.mock('@/services/repository')` in the calling file.
 */
export function activeSponsor({
	shortId = TEST_SPONSOR_SHORT_ID,
	githubUsername = 'someone',
	sources = ['github'] as SponsorSource[],
	keyVersion = 1,
	ttlMs = 3_600_000,
}: {
	shortId?: string;
	githubUsername?: string;
	sources?: SponsorSource[];
	keyVersion?: number;
	ttlMs?: number;
} = {}): string {
	const lookup: SponsorLookup = { isSponsor: true, sources, shortId, githubUsername, keyVersion };
	vi.mocked(repository.getSponsorByShortId).mockResolvedValue(lookup);
	return signSponsorToken({
		shortId,
		githubUsername,
		sources,
		keyVersion,
		exp: Date.now() + ttlMs,
	});
}

/**
 * Leaves any token already minted signed and unexpired, but points the row it
 * names at a sponsorship that is no longer paying — what gatekeeper's sync
 * leaves behind when a pledge ends.
 */
export function sponsorshipLapsed(shortId = TEST_SPONSOR_SHORT_ID): void {
	vi.mocked(repository.getSponsorByShortId).mockResolvedValue({
		isSponsor: false,
		sources: [],
		shortId,
		githubUsername: 'someone',
		keyVersion: 1,
	});
}
