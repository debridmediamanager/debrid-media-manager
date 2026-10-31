import { NEWZNAB_AUTH_MESSAGES } from '@/services/newznab/auth';
import { describe, expect, it } from 'vitest';

// Prowlarr, Sonarr and Radarr log a refused indexer's description. A bare
// "credentials" or "lapsed" sent a sponsor looking for the fix, so both say where it is.
describe('Newznab and Torznab refusal descriptions', () => {
	it('send a wrong key and a lapsed sponsorship to gatekeeper', () => {
		expect(NEWZNAB_AUTH_MESSAGES[100]).toContain('https://gatekeeper.debridmediamanager.com');
		expect(NEWZNAB_AUTH_MESSAGES[101]).toContain('https://gatekeeper.debridmediamanager.com');
		expect(NEWZNAB_AUTH_MESSAGES[101]).toMatch(/no longer active/);
	});
});
