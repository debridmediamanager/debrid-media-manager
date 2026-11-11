/**
 * What a signed-in free account gets instead of a list.
 *
 * Simkl answers that case with **HTTP 200** carrying `premium_only` and a
 * singular, renderable `item` - a placeholder titled "Upgrade to Simkl PRO/VIP"
 * complete with a poster - so a client that trusts the status code shows it as
 * though the user had added it to their own list. DMM throws on that body
 * instead and says plainly why the list is empty.
 */
export function SimklPremiumNotice() {
	return (
		<div className="rounded border-2 border-amber-500 bg-amber-900/30 p-3 text-sm text-amber-100">
			<p className="font-medium">Simkl custom lists need PRO or VIP</p>
			<p className="mt-1 text-amber-200/80">
				Your Simkl account is on the free plan, and Simkl serves custom lists only to paid
				accounts. Everything else in DMM works as before.
			</p>
			<a
				href="https://simkl.com/vip/"
				target="_blank"
				rel="noopener noreferrer"
				className="mt-2 inline-block rounded border border-amber-400/60 bg-amber-950/40 px-2 py-1 text-xs font-medium transition-colors hover:bg-amber-800/60"
			>
				See Simkl plans
			</a>
		</div>
	);
}
