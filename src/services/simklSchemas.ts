import * as v from '@badrap/valita';
import type { SimklList, SimklListItem, SimklListSummary, SimklUser } from './simkl';
import type { SimklTokens } from './simklProvider';

const positiveInteger = v
	.number()
	.assert((value) => Number.isSafeInteger(value) && value > 0, 'Invalid positive integer');
const nonnegativeInteger = v
	.number()
	.assert((value) => Number.isSafeInteger(value) && value >= 0, 'Invalid nonnegative integer');
export const simklTimestampSchema = v
	.number()
	.assert((value) => Number.isFinite(value) && value >= 0, 'Invalid timestamp');
export const simklCacheKeySchema = v
	.string()
	.assert((value) => /^[A-Za-z0-9_-]{32}$/.test(value), 'Invalid cache key');
const credential = v.string().assert((value) => value.length > 0, 'Empty credential');
export const simklTokensSchema: v.Type<SimklTokens> = v.object({
	access_token: credential,
	token_type: credential,
	expires_in: v
		.number()
		.assert((value) => Number.isFinite(value) && value > 0, 'Invalid lifetime'),
	refresh_token: credential.optional(),
	scope: v.string().optional(),
});
const userFields = {
	name: v.string(),
	joined_at: v.string().optional(),
	gender: v.string().optional(),
	avatar: v.string().optional(),
	bio: v.string().optional(),
	loc: v.string().optional(),
};
const accountFields = {
	id: positiveInteger,
	timezone: v.string().optional(),
	type: v.union(v.literal('free'), v.literal('pro'), v.literal('vip')),
};
export const simklUserSchema: v.Type<SimklUser> = v.object({
	user: v.object({ ...userFields, age: v.number().optional() }),
	account: v.object(accountFields),
});
// The captured settings response formats age as "27 years". DMM's public
// profile contract has a numeric age; do not pretend that string is a number.
export const simklProviderUserSchema: v.Type<SimklUser> = v
	.object({
		user: v
			.object({ ...userFields, age: v.union(v.number(), v.string()).optional() })
			.rest(v.unknown()),
		account: v.object(accountFields).rest(v.unknown()),
	})
	.rest(v.unknown())
	.map((profile) => ({
		...profile,
		user: {
			...profile.user,
			age: typeof profile.user.age === 'number' ? profile.user.age : undefined,
		},
	}));
const listSummaryFields = {
	id: positiveInteger,
	name: v.string(),
	slug: v.string().optional(),
	description: v
		.object({ short: v.string().nullable(), full: v.string().nullable() })
		.rest(v.unknown())
		.optional(),
	media_type: v.string().optional(),
	type: v.string().optional(),
	privacy: v.string().optional(),
	user: v
		.object({ id: positiveInteger, name: v.string(), avatar: v.string().optional() })
		.rest(v.unknown())
		.optional(),
	counts: v
		.object({
			items: nonnegativeInteger,
			likes: nonnegativeInteger,
			followers: nonnegativeInteger,
			comments: nonnegativeInteger,
		})
		.rest(v.unknown())
		.optional(),
	updated_at: v.string().optional(),
	created_at: v.string().optional(),
	pinned: v.boolean().optional(),
};
export const simklListSummarySchema: v.Type<SimklListSummary> = v
	.object(listSummaryFields)
	.rest(v.unknown());
export const simklListItemSchema: v.Type<SimklListItem> = v
	.object({
		title: v.string(),
		// Official CustomListItem declares unknown year/poster as Type 4 null.
		// Normalize fields here, without a second item-array traversal.
		year: v
			.number()
			.nullable()
			.map((value) => value ?? undefined)
			.optional(),
		type: v.string(),
		anime_type: v.string().optional(),
		poster: v
			.string()
			.nullable()
			.map((value) => value ?? undefined)
			.optional(),
		position: v.number().optional(),
		ids: v
			.object({
				simkl_id: positiveInteger,
				slug: v.string().optional(),
				imdb: v.string().optional(),
				tmdb: v.string().optional(),
				tvdb: v.string().optional(),
				tvdbslug: v.string().optional(),
				traktslug: v.string().optional(),
			})
			.rest(v.unknown()),
	})
	.rest(v.unknown());
export const simklListsSchema = v.array(simklListSummarySchema);
export const simklListSchema: v.Type<SimklList> = v
	.object({ ...listSummaryFields, items: v.array(simklListItemSchema) })
	.rest(v.unknown());
export const simklPaginationSchema = v
	.object({
		page: positiveInteger,
		limit: positiveInteger,
		total_items: nonnegativeInteger,
		total_pages: nonnegativeInteger,
	})
	.rest(v.unknown());
export const simklUserListsPageSchema = v
	.object({
		pagination: simklPaginationSchema.optional(),
		lists: simklListsSchema.optional(),
	})
	.rest(v.unknown());
export const simklListPageSchema = v
	.object({
		...listSummaryFields,
		pagination: simklPaginationSchema.optional(),
		items: v.array(simklListItemSchema).optional(),
	})
	.rest(v.unknown());
export const simklProviderErrorSchema = v
	.object({
		error: v.string(),
		message: v.string().optional(),
		error_description: v.string().optional(),
		code: v.number().optional(),
	})
	.rest(v.unknown());
export const simklPublicSessionSchema = v.object({
	user: simklUserSchema,
	cacheKey: simklCacheKeySchema,
	expiresAt: simklTimestampSchema,
});
export const simklOkSchema = v.object({ ok: v.literal(true) });
export const simklApiErrorSchema = v.object({
	error: v.string(),
	message: v.string(),
	status: v.number(),
});
export const simklRevokeSchema = v.object({}).rest(v.unknown());
