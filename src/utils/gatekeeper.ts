/**
 * Where a sponsor gets the DMM API key that opens the sponsor features.
 *
 * Named once because every surface that gates on a sponsorship has to point at
 * it: the sponsorship panel, the cast stream limits, both indexer setup pages
 * and the home page footer. A feature that is visible but unreachable is worse
 * than a hidden one, so none of them may be the surface that forgets the link.
 */
export const GATEKEEPER_URL = 'https://gatekeeper.debridmediamanager.com';
