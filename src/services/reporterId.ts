import { createHash } from 'crypto';

const TAGGED = /^(pm|oc|dl):(.+)$/s;

/**
 * The reporter id as it is written to the `Report` table.
 *
 * A tagged credential (`pm:`, `oc:`, `dl:` - see `reporterIdFor`) is stored as
 * a SHA-256 digest under the same tag, so a moderation table never becomes a
 * second copy of those users' credentials. Anything else is stored as sent,
 * as it always has been.
 */
export function storedReporterId(userId: string): string {
	const match = TAGGED.exec(userId);
	if (!match) return userId;
	return `${match[1]}:${createHash('sha256').update(match[2]).digest('hex')}`;
}
