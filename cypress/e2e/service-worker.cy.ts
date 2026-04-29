describe('Service Worker', () => {
	it('registers without precaching errors', () => {
		const swErrors: string[] = [];

		cy.visit('/start', {
			onBeforeLoad(win) {
				const origConsoleError = win.console.error.bind(win.console);
				win.console.error = (...args: unknown[]) => {
					const msg = args.map(String).join(' ');
					if (msg.includes('bad-precaching-response')) {
						swErrors.push(msg);
					}
					origConsoleError(...args);
				};
			},
		});

		cy.contains('Welcome to Debrid Media Manager').should('be.visible');

		// Allow time for service worker installation to complete or fail
		cy.wait(3000).then(() => {
			expect(swErrors, 'service worker precaching errors').to.deep.equal([]);
		});
	});

	it('does not serve 404 for precached assets', () => {
		cy.request({ url: '/service-worker.js', failOnStatusCode: false }).then((resp) => {
			expect(resp.status).to.eq(200);

			const urlMatches = resp.body.matchAll(/url:"([^"]+)"/g);
			const precacheUrls: string[] = Array.from(urlMatches, (m: RegExpMatchArray) => m[1]);

			const staticUrls = precacheUrls.filter(
				(url: string) => url.startsWith('/_next/static/') || url.startsWith('/')
			);

			// Spot-check a sample of precached URLs to verify they don't 404
			const sample = staticUrls.filter((url: string) => url.endsWith('.js')).slice(0, 5);
			sample.forEach((url: string) => {
				cy.request({ url, failOnStatusCode: false }).then((assetResp) => {
					expect(assetResp.status, `${url} should not 404`).to.not.eq(404);
				});
			});
		});
	});
});
