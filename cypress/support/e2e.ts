import './commands';

// Register first: later, scenario-specific fixtures may reply before this
// fallback. Unmodelled requests must never reach a provider or proxy.
beforeEach(() => {
	const appOrigin = new URL(Cypress.config('baseUrl')!).origin;
	cy.intercept('**', (request) => {
		const url = new URL(request.url);
		let pathname = url.pathname;
		for (let depth = 0; depth < 8; depth++) {
			try {
				const decoded = decodeURIComponent(pathname);
				if (decoded === pathname) break;
				pathname = decoded;
			} catch {
				request.destroy();
				return;
			}
		}
		const safeRead =
			request.method === 'GET' &&
			/^\/api\/(?:(?:healthz|challenge|calendar|trakt\/search)$|(?:info|browse|takedown)\/)/.test(
				pathname
			);
		const safeAvailability =
			request.method === 'POST' &&
			/^\/api\/availability\/(?:check2|playable)$/.test(pathname);
		if (
			url.origin !== appOrigin ||
			pathname.includes('%') ||
			pathname.split('/').some((part) => part === '.' || part === '..') ||
			/(?:^|\/)anticors(?:\/|$)/i.test(pathname) ||
			(pathname.startsWith('/api/') && !safeRead && !safeAvailability)
		) {
			request.destroy();
			return;
		}
		request.continue();
	});
});
