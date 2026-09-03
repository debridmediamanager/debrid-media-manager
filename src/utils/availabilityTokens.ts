// Search tokens that filter results by debrid availability. They are mutually
// exclusive: quickSearch ANDs every term, so "is:rd is:tb" would mean "cached in
// both", which is never what a click on a second service button intends.
export const AVAILABILITY_TOKENS = [
	'is:rd',
	'is:ad',
	'is:tb',
	'is:pm',
	'is:oc',
	'is:cached',
	'is:uncached',
] as const;

export type AvailabilityToken = (typeof AVAILABILITY_TOKENS)[number];

export function hasAvailabilityToken(query: string, token: string): boolean {
	return query.split(/\s+/).includes(token);
}

/**
 * Add the token to the query, or remove it when it is already active. Any other
 * availability token is dropped, so only one is ever in effect.
 */
export function toggleAvailabilityToken(query: string, token: string): string {
	const terms = query.split(/\s+/).filter(Boolean);
	const isActive = terms.includes(token);
	const rest = terms.filter((term) => !AVAILABILITY_TOKENS.includes(term as AvailabilityToken));
	return (isActive ? rest : [...rest, token]).join(' ');
}
