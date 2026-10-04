/**
 * The notice videos a DMM Cast play link redirects to when it cannot play the
 * file, and the text each one shows. `scripts/build-cast-play-videos.ts`
 * renders them from this list into `public/`, so changing a line here means
 * running it again.
 *
 * Why a video: a play URL is fetched by the video player itself. No player
 * shows the body of a failed answer, and dmm-01's log for 2026-09-27..10-03
 * shows players repeat a 403 at least as often as a 500. Every player in that
 * log does follow a redirect to a file it can play, because that is what a
 * successful play is.
 *
 * Why two minutes of a still frame: Stremio marks an episode watched once 70%
 * of what played has been watched, and moves Continue Watching on at 90%
 * (stremio-core `WATCHED_THRESHOLD_COEF`, `CREDITS_THRESHOLD_COEF`). A member
 * reads the notice and stops long before 84 seconds.
 *
 * They live under `noprecache/` because next-pwa puts every other file in
 * `public/` into the service worker's precache, which every visitor downloads.
 */

export type CastPlayVideo =
	| 'sign-in-again'
	| 'set-up-again'
	| 'account-refused'
	| 'network-refused'
	| 'file-unavailable'
	| 'confirm-sign-in';

export const CAST_PLAY_VIDEO_DIR = 'noprecache/cast-play';

/** Seconds each video runs. */
export const CAST_PLAY_VIDEO_SECONDS = 120;

export const CAST_PLAY_VIDEOS: Record<CastPlayVideo, { title: string; lines: string[] }> = {
	'sign-in-again': {
		title: 'Sign in to your debrid service again',
		lines: [
			'Your debrid service no longer accepts the sign-in',
			'this DMM Cast addon uses.',
			'',
			'Open debridmediamanager.com, sign in again, then',
			"open your service's DMM Cast page once.",
			'The addon picks it up by itself. Nothing to reinstall.',
		],
	},
	'set-up-again': {
		title: 'Set up DMM Cast again',
		lines: [
			'This DMM Cast addon is no longer connected',
			'to an account.',
			'',
			'Open debridmediamanager.com, sign in to your debrid',
			'service, open its DMM Cast page and install the',
			'addon again from there.',
		],
	},
	'account-refused': {
		title: 'Your debrid account refused this stream',
		lines: [
			'Your debrid service will not make streaming links',
			'for this account right now.',
			'',
			'Check on its website that your premium plan is',
			'active and the account is not locked, then try again.',
		],
	},
	'network-refused': {
		title: 'Your network was refused',
		lines: [
			'Your debrid service will not make a streaming link',
			'for the network this player is on, such as a VPN,',
			'a proxy or a hosted server.',
			'',
			'Turn the VPN off or play from your home connection,',
			'then try again.',
		],
	},
	'file-unavailable': {
		title: 'This file is not available',
		lines: [
			'Your debrid service can no longer serve this file.',
			'',
			'Go back and pick another stream.',
		],
	},
	'confirm-sign-in': {
		title: 'Confirm the new sign-in',
		lines: [
			'Your debrid service has emailed you about a new',
			'sign-in from DMM Cast. It holds every stream',
			'until you confirm it.',
			'',
			'Open that email and confirm the sign-in.',
			'Then play this again.',
		],
	},
};

export const castPlayVideoUrl = (video: CastPlayVideo) =>
	`${process.env.DMM_ORIGIN || 'https://debridmediamanager.com'}/${CAST_PLAY_VIDEO_DIR}/${video}.mp4`;
