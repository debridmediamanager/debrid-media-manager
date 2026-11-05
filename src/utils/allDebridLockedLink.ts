export const isAllDebridLockedLink = (link: unknown): link is string =>
	typeof link === 'string' && /^https:\/\/alldebrid\.com\/f\/[A-Za-z0-9_-]{43}$/.test(link);
