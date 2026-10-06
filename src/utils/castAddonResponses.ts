import type { NextApiResponse } from 'next';
import { CastFailure, CastPlayFailure, classifyCastError } from './castAddonFailure';
import { CastPlayVideo, castPlayVideoUrl } from './castPlayVideos';

/**
 * How every DMM Cast addon answers when it cannot serve a catalog, meta or
 * stream request, for all six providers alike.
 *
 * What clients do with each shape, read from their source (2026-10-04):
 *
 * - Nothing reads `cacheMaxAge` from the body - not stremio-core, not Nuvio,
 *   not AIOMetadata. Only the HTTP `Cache-Control` header counts, so every
 *   answer here sets one.
 * - A 500 and a 503 behave identically everywhere, and nobody reads
 *   `Retry-After`. 503 is still used for "try again later" because it keeps
 *   our own access logs honest: a 500 means a DMM bug.
 * - Stremio web prints a failing catalog's raw error ("Unexpected HTTP status
 *   code 503") as a Board row, but hides a row whose `metas` is empty. NuvioTV
 *   and AIOMetadata treat the two the same. So a catalog that could not be
 *   read this time answers an empty page.
 * - Native Stremio keeps serving its last good copy of a meta or stream list
 *   when the refresh errors, and a 200 would overwrite that copy, so those
 *   two answer 503 - which Stremio web drops silently from a stream list.
 * - A problem only the member can fix gets a notice they can see and tap: a
 *   tile in the catalog, a meta, or a stream that opens the page that fixes
 *   it: DMM for a sign-in, the provider's own account page for an account the
 *   provider refuses. It is cached for five minutes at most - without a
 *   header NuvioTV keeps a meta six hours, long after the member has signed
 *   in again.
 */

export type CastProvider = 'rd' | 'ad' | 'tb' | 'pm' | 'oc' | 'dl';

/**
 * `account` is where a member sees their plan on the provider's own site; a
 * signed-out visitor is sent to its sign-in first.
 */
const PROVIDERS: Record<
	CastProvider,
	{ name: string; idPrefix: string; page: string; account: string }
> = {
	rd: {
		name: 'Real-Debrid',
		idPrefix: 'dmm',
		page: '/stremio',
		account: 'https://real-debrid.com/account',
	},
	ad: {
		name: 'AllDebrid',
		idPrefix: 'dmm-ad',
		page: '/stremio-alldebrid',
		account: 'https://alldebrid.com/account/',
	},
	tb: {
		name: 'TorBox',
		idPrefix: 'dmm-tb',
		page: '/stremio-torbox',
		account: 'https://torbox.app/settings',
	},
	pm: {
		name: 'Premiumize',
		idPrefix: 'dmm-pm',
		page: '/stremio-premiumize',
		account: 'https://www.premiumize.me/account',
	},
	oc: {
		name: 'Offcloud',
		idPrefix: 'dmm-oc',
		page: '/stremio-offcloud',
		account: 'https://offcloud.com/',
	},
	dl: {
		name: 'Debrid-Link',
		idPrefix: 'dmm-dl',
		page: '/stremio-debridlink',
		account: 'https://debrid-link.com/webapp/account',
	},
};

const POSTER = 'https://static.debridmediamanager.com/dmmcast.png';
const BACKGROUND = 'https://static.debridmediamanager.com/background.png';

const NOTICE_CACHE = 'max-age=300';
const NO_STORE = 'no-store';

const setupUrl = (provider: CastProvider) =>
	`${process.env.DMM_ORIGIN || 'https://debridmediamanager.com'}${PROVIDERS[provider].page}`;

/** The failures a member can fix, and therefore the ones worth a notice. */
type NoticeFailure = Extract<CastFailure, 'not-connected' | 'credential' | 'account' | 'confirm'>;

const NOTICE_FAILURES: readonly string[] = ['not-connected', 'credential', 'account', 'confirm'];

const isNoticeFailure = (failure: string): failure is NoticeFailure =>
	NOTICE_FAILURES.includes(failure);

/**
 * The page a notice opens: the provider's site for its own refusal, else DMM.
 * A held sign-in is cleared only by the link in the provider's email, which
 * DMM never sees, so its notice opens the account the email was sent for.
 */
const onProviderSite = (failure: NoticeFailure) => failure === 'account' || failure === 'confirm';

const noticeUrl = (provider: CastProvider, failure: NoticeFailure) =>
	onProviderSite(failure) ? PROVIDERS[provider].account : setupUrl(provider);

const noticeText = (provider: CastProvider, failure: NoticeFailure) => {
	const { name } = PROVIDERS[provider];
	const url = setupUrl(provider);
	if (failure === 'account') {
		return {
			title: `${name} refused your account`,
			description: `${name} accepts this addon's sign-in but will not serve the account behind it. The premium plan may have run out or the account may be locked. Check your account at ${PROVIDERS[provider].account}. Nothing needs to change on Debrid Media Manager. This addon works again as soon as the account does.`,
		};
	}
	if (failure === 'confirm') {
		return {
			title: `Confirm the new ${name} sign-in`,
			description: `${name} holds this addon's requests until you confirm a new sign-in. It emailed the address on your ${name} account when DMM Cast's server first used your key. Open that email and confirm the sign-in, then come back here. Nothing needs to change on Debrid Media Manager, and there is nothing to reinstall.`,
		};
	}
	if (failure === 'credential') {
		return {
			title: `Sign in to ${name} again`,
			description: `${name} no longer accepts the sign-in this addon was set up with. Sign in to ${name} on Debrid Media Manager, then open ${url} once. This addon picks up the new sign-in by itself, so there is nothing to reinstall, and your casts are kept.`,
		};
	}
	return {
		title: `Set up DMM Cast for ${name} again`,
		description: `This addon's DMM Cast profile no longer exists. Sign in to ${name} on Debrid Media Manager and open ${url} to set it up again, then reinstall the addon from that page.`,
	};
};

/**
 * The id a notice tile carries. It sits under the provider's own meta prefix
 * so that opening the tile comes back to this addon's meta route, which
 * answers it from {@link castNoticeMeta} without touching the database or the
 * provider - every DMM Cast addon is asked about every `dmm` id.
 */
export const castNoticeId = (provider: CastProvider, failure: NoticeFailure) =>
	`${PROVIDERS[provider].idPrefix}:notice:${failure}`;

const noticePreview = (provider: CastProvider, failure: NoticeFailure) => {
	const { title, description } = noticeText(provider, failure);
	return {
		id: castNoticeId(provider, failure),
		type: 'other',
		name: `⚠️ ${title}`,
		description,
		poster: POSTER,
	};
};

/**
 * The full meta behind a notice. Its one video carries an `externalUrl`
 * stream, so a client that cannot show a link in the description still gives
 * the member one tap to the page that fixes it.
 */
const noticeMeta = (provider: CastProvider, failure: NoticeFailure, id?: string) => {
	const preview = noticePreview(provider, failure);
	const metaId = id ?? preview.id;
	return {
		...preview,
		id: metaId,
		background: BACKGROUND,
		videos: [
			{
				id: `${metaId}:open`,
				title: `Open ${noticeUrl(provider, failure)}`,
				streams: [
					{
						name: 'DMM Cast',
						title: onProviderSite(failure)
							? `Open your ${PROVIDERS[provider].name} account`
							: `Open ${PROVIDERS[provider].name} setup on Debrid Media Manager`,
						externalUrl: noticeUrl(provider, failure),
					},
				],
			},
		],
	};
};

/**
 * The answer to a meta request for one of this provider's notice ids, or null
 * when the id is not a notice. Check it before parsing an id as a library
 * entry - `dmm-oc:notice:credential` would otherwise be sent to Offcloud.
 */
export function castNoticeMeta(provider: CastProvider, metaId: string) {
	const prefix = `${PROVIDERS[provider].idPrefix}:notice:`;
	if (!metaId.startsWith(prefix)) return null;
	const failure = metaId.slice(prefix.length);
	if (!isNoticeFailure(failure)) return null;
	return { meta: noticeMeta(provider, failure), cacheMaxAge: 0 };
}

/** Sends {@link castNoticeMeta}'s answer, with the notice cache header. */
export function sendNoticeMeta(res: NextApiResponse, notice: ReturnType<typeof castNoticeMeta>) {
	res.setHeader('Cache-Control', NOTICE_CACHE);
	return res.status(200).json(notice);
}

/** A helper's `{error, status}` result, read as the failure it stands for. */
export function castFailureFromStatus(status: number): CastFailure {
	if (status === 401) return 'not-connected';
	if (status === 403) return 'credential';
	if (status === 400 || status === 404) return 'gone';
	return 'unavailable';
}

const logFailure = (provider: CastProvider, resource: string, error: unknown) => {
	// The message only: an AxiosError's own serialisation carries its request
	// config, and for Real-Debrid's token call that is the OAuth body.
	console.error(
		`[DMM Cast ${PROVIDERS[provider].name}] ${resource} failed:`,
		error instanceof Error ? error.message : String(error)
	);
};

/**
 * A catalog that could not be read.
 *
 * Only the first page carries a notice: a client that already holds page one
 * would otherwise append the same tile once per scroll.
 */
export function sendCatalogFailure(
	res: NextApiResponse,
	provider: CastProvider,
	failure: CastFailure,
	options: { firstPage: boolean }
) {
	if (isNoticeFailure(failure)) {
		res.setHeader('Cache-Control', NOTICE_CACHE);
		return res.status(200).json({
			metas: options.firstPage ? [noticePreview(provider, failure)] : [],
			hasMore: false,
			cacheMaxAge: 0,
		});
	}
	res.setHeader('Cache-Control', NO_STORE);
	return res.status(200).json({ metas: [], hasMore: false, cacheMaxAge: 0 });
}

/** {@link sendCatalogFailure} for a thrown error. */
export function sendCatalogError(
	res: NextApiResponse,
	provider: CastProvider,
	error: unknown,
	options: { firstPage: boolean }
) {
	logFailure(provider, 'catalog', error);
	return sendCatalogFailure(res, provider, classifyCastError(error), options);
}

type HelperResult<T> = { data: T; status: number } | { error: string; status: number };

/**
 * Answers one page of a library catalog from a helper's result, so that every
 * provider fails the same way: a notice the member can act on, or an empty
 * page - never an unhandled exception.
 */
export async function sendLibraryPage<T>(
	res: NextApiResponse,
	provider: CastProvider,
	page: number,
	load: () => Promise<HelperResult<T>>
) {
	const firstPage = page <= 1;
	try {
		const result = await load();
		if ('error' in result) {
			return sendCatalogFailure(res, provider, castFailureFromStatus(result.status), {
				firstPage,
			});
		}
		return res.status(result.status).json(result.data);
	} catch (error) {
		return sendCatalogError(res, provider, error, { firstPage });
	}
}

/**
 * One library entry's meta that could not be built.
 *
 * An entry the account no longer holds is a 404, which NuvioTV takes as final
 * once every addon agrees; a 500 there was retried on every focus.
 */
export function sendMetaFailure(
	res: NextApiResponse,
	provider: CastProvider,
	failure: CastFailure,
	metaId: string
) {
	if (isNoticeFailure(failure)) {
		res.setHeader('Cache-Control', NOTICE_CACHE);
		return res
			.status(200)
			.json({ meta: noticeMeta(provider, failure, metaId), cacheMaxAge: 0 });
	}
	res.setHeader('Cache-Control', NO_STORE);
	if (failure === 'gone' || failure === 'unplayable') {
		return res.status(404).json({ meta: null });
	}
	return res.status(503).json({ meta: null, error: 'Temporarily unavailable' });
}

/** {@link sendMetaFailure} for a thrown error. */
export function sendMetaError(
	res: NextApiResponse,
	provider: CastProvider,
	error: unknown,
	metaId: string
) {
	logFailure(provider, 'library meta', error);
	return sendMetaFailure(res, provider, classifyCastError(error), metaId);
}

/**
 * A meta id that belongs to some other addon. Every DMM Cast addon's prefix
 * starts with `dmm`, and NuvioTV asks the first addon with an `other` meta
 * resource for every `other` id, whatever its prefix - so this is the common
 * case on these routes, and it must cost nothing.
 */
export function sendForeignMeta(res: NextApiResponse) {
	res.setHeader('Cache-Control', NO_STORE);
	return res.status(404).json({ meta: null });
}

/**
 * A stream list that could not be built. A member-fixable problem gets one
 * stream that opens the setup page, the shape the legacy-token notice uses.
 */
export function sendStreamFailure(
	res: NextApiResponse,
	provider: CastProvider,
	failure: CastFailure
) {
	if (isNoticeFailure(failure)) {
		const { title } = noticeText(provider, failure);
		res.setHeader('Cache-Control', NOTICE_CACHE);
		return res.status(200).json({
			streams: [
				{
					name: '⚠️ DMM Cast',
					title,
					externalUrl: noticeUrl(provider, failure),
				},
			],
			cacheMaxAge: 0,
		});
	}
	res.setHeader('Cache-Control', NO_STORE);
	return res.status(503).json({ streams: [], error: 'Temporarily unavailable' });
}

/** {@link sendStreamFailure} for a thrown error. */
export function sendStreamError(res: NextApiResponse, provider: CastProvider, error: unknown) {
	logFailure(provider, 'stream list', error);
	return sendStreamFailure(res, provider, classifyCastError(error));
}

/**
 * The notice each play failure redirects to. A temporary failure has none: the
 * player's own retries may well get through, and a notice would end them.
 */
const PLAY_NOTICES: Partial<Record<CastPlayFailure, CastPlayVideo>> = {
	'not-connected': 'set-up-again',
	credential: 'sign-in-again',
	account: 'account-refused',
	network: 'network-refused',
	confirm: 'confirm-sign-in',
	gone: 'file-unavailable',
	unplayable: 'file-unavailable',
	refused: 'file-unavailable',
};

/**
 * A play link that cannot reach its file.
 *
 * The player fetches this URL itself and never shows a response body, so a
 * failure the member has to know about redirects to a short video that says
 * what happened and what to do, the way a working play redirects to the file.
 * A temporary one answers 503. `detail` is what the provider said, for our log.
 */
export function sendPlayFailure(
	res: NextApiResponse,
	provider: CastProvider,
	failure: CastPlayFailure,
	detail: string
) {
	console.error(`[DMM Cast ${PROVIDERS[provider].name}] play failed: ${failure} (${detail})`);
	res.setHeader('Cache-Control', NO_STORE);
	const video = PLAY_NOTICES[failure];
	if (video) return res.redirect(307, castPlayVideoUrl(video));
	return res.status(503).json({ error: 'Temporarily unavailable' });
}
