export type Availability =
	| 'all:available'
	| 'rd:available'
	| 'ad:available'
	| 'unavailable'
	| 'no_videos';
export type HashAvailability = Record<string, Availability>;
