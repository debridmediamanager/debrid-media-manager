describe('Service Worker', () => {
	beforeEach(() => {
		cy.visit('/start');
		cy.contains('Welcome to Debrid Media Manager').should('be.visible');
	});

	it('keeps opt-in playback notice videos out of installation downloads', () => {
		cy.window().then({ timeout: 30000 }, async (win) => {
			await win.navigator.serviceWorker.ready;
			const caches = await Promise.all(
				(await win.caches.keys()).map((name) => win.caches.open(name))
			);
			const installed = (await Promise.all(caches.map((cache) => cache.keys()))).flat();
			expect(
				installed.filter((request) =>
					new URL(request.url).pathname.startsWith('/noprecache/')
				),
				'opt-in playback payloads installed without a playback request'
			).to.have.length(0);
		});
		cy.request('/noprecache/cast-play/file-unavailable.mp4').its('status').should('eq', 200);
	});

	it('does not persist API navigation URLs or response bodies in the page cache', () => {
		cy.window().then({ timeout: 30000 }, async (win) => {
			await win.navigator.serviceWorker.ready;
			if (!win.navigator.serviceWorker.controller) {
				const controlled = Promise.withResolvers<void>();
				win.navigator.serviceWorker.addEventListener(
					'controllerchange',
					() => controlled.resolve(),
					{ once: true }
				);
				await controlled.promise;
			}
			const url = new URL(
				'/api/healthz?token=task-only-not-a-credential&link=task-only-not-a-download',
				win.location.href
			).href;
			const frame = win.document.createElement('iframe');
			try {
				const loaded = Promise.withResolvers<void>();
				frame.onload = () => loaded.resolve();
				frame.onerror = () => loaded.reject(new Error('Task API navigation failed'));
				frame.src = url;
				win.document.body.appendChild(frame);
				await loaded.promise;
				expect(frame.contentDocument?.body.textContent).to.contain('"status":"ok"');
				expect(
					await win.caches.match(url),
					'API response and its request query remain network-only'
				).to.eq(undefined);
			} finally {
				frame.remove();
			}
		});
	});

	it('caches a completed frontend route as an application HTML document', () => {
		cy.window().then(async (win) => {
			await win.navigator.serviceWorker.ready;
			await (
				await win.caches.open('pages')
			).delete('/alldebrid/login', { ignoreSearch: true });
		});
		cy.contains('button', 'Login with AllDebrid').click();
		cy.location('pathname').should('eq', '/alldebrid/login');
		cy.window().then({ timeout: 15000 }, async (win) => {
			const deadline = Date.now() + 10000;
			let response: Response | undefined;
			while (
				!(response = await win.caches.match(win.location.href)) &&
				Date.now() < deadline
			) {
				const tick = Promise.withResolvers<void>();
				win.setTimeout(tick.resolve, 50);
				await tick.promise;
			}
			expect(response, 'frontend route document cached by the service worker').not.to.eq(
				undefined
			);
			expect(response!.headers.get('content-type')).to.contain('text/html');
			expect(await response!.text()).to.contain('Connect AllDebrid');
		});
	});
});
