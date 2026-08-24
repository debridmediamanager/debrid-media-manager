/**
 * What the tab a Watch click opens actually contains.
 *
 * It used to contain nothing: the tab was opened blank and then navigated by
 * assigning `intent://…` to its `location.href`. Android Chrome refuses that —
 * a scripted jump to an app is a "JavaScript redirect to an app" and is blocked
 * outright, and Chrome's own intent documentation lists "the link is triggered
 * by JavaScript without user gesture" as a case where it will not launch an
 * external application. With no `browser_fallback_url` on the intent there was
 * nothing to fall back to either, so the blank tab simply stayed blank.
 *
 * Waiting for a gesture is not optional and cannot be dodged by opening the tab
 * earlier: Real-Debrid's resolve alone runs five sequential API calls behind a
 * 240ms floor, so by the time an intent exists the click that started it is far
 * past Chrome's activation window. The tab therefore renders a real link and
 * lets the user's tap be the navigation — that tap carries the gesture on every
 * platform, however long the resolve took.
 *
 * The link is autofocused because the devices this hits hardest are Android TV
 * boxes driven by a D-pad, where "tap Play" means landing on the control and
 * pressing OK.
 */

/** The slice of a popup window this module touches. */
export type WatchTab = {
	document: Document;
};

export type WatchTabView =
	| { status: 'resolving'; label: string }
	| { status: 'ready'; label: string; intent: string }
	| { status: 'error'; label: string; message: string };

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

const shell = (title: string, body: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
html,body{margin:0;height:100%;background:#111827;color:#e5e7eb;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:1rem;padding:1.5rem;text-align:center;box-sizing:border-box}
h1{margin:0;font-size:1.25rem;font-weight:600}
p{margin:0;max-width:32rem;color:#9ca3af;font-size:.95rem;line-height:1.5}
.play{display:inline-block;padding:.9rem 2.5rem;border-radius:.5rem;border:2px solid #14b8a6;
background:rgba(19,78,74,.35);color:#ccfbf1;font-size:1.15rem;font-weight:700;text-decoration:none}
.play:focus,.play:hover{background:rgba(17,94,89,.6);outline:3px solid #2dd4bf}
.err{color:#fca5a5;word-break:break-word}
</style></head>
<body><div class="wrap">${body}</div></body></html>`;

const render = (view: WatchTabView): string => {
	if (view.status === 'resolving') {
		return shell(
			`Opening in ${view.label}…`,
			`<h1>Getting your stream from ${escapeHtml(view.label)}…</h1>
<p>This can take a few seconds.</p>`
		);
	}
	if (view.status === 'error') {
		return shell(
			'Watch failed',
			`<h1>${escapeHtml(view.label)} could not start this</h1>
<p class="err">${escapeHtml(view.message)}</p>
<p>Close this tab and try another result.</p>`
		);
	}
	return shell(
		'Ready to play',
		`<h1>Ready to play</h1>
<a class="play" href="${escapeHtml(view.intent)}" autofocus>▶ Play</a>
<p>Your player opens when you press Play. Browsers only hand a stream to an app
on a real tap, which is why this step cannot happen on its own.</p>`
	);
};

/**
 * Replaces the watch tab's contents.
 *
 * Everything here is best-effort: the user may have closed the tab, and reading
 * `document` on a closed window throws. A watch that cannot draw its tab is
 * still a watch that resolved, so nothing is allowed to escape.
 */
export const renderWatchTab = (tab: WatchTab | null | undefined, view: WatchTabView): void => {
	if (!tab) return;
	try {
		const doc = tab.document;
		doc.open();
		doc.write(render(view));
		doc.close();
	} catch {
		// Tab closed, or navigated somewhere we no longer own.
	}
};
