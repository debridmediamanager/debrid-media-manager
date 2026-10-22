import ozCapture from '../../src/test/fixtures/scraped/oz-remux-2026-10-22.json';
import { authLocalStorage, rdUserFixture } from '../support/commands';

describe('Movie Detail Page', () => {
	const authSetup = {
		onBeforeLoad(win: Cypress.AUTWindow) {
			for (const [key, value] of Object.entries(authLocalStorage)) {
				win.localStorage.setItem(key, value);
			}
		},
	};

	beforeEach(() => {
		cy.intercept('GET', '**/rest/1.0/user', {
			statusCode: 200,
			body: rdUserFixture,
		});

		// Mock movie info API - response matches actual /api/info/movie shape
		cy.intercept('GET', '**/api/info/movie**', {
			statusCode: 200,
			body: {
				title: 'The Shawshank Redemption',
				description: 'Two imprisoned men bond over a number of years.',
				poster: '',
				backdrop: '',
				year: '1994',
				imdb_score: 93,
				trailer: '',
			},
		}).as('movieInfo');
	});

	it('renders the movie detail page', () => {
		cy.visit('/movie/tt0111161', authSetup);
		cy.wait('@movieInfo');
		cy.contains('The Shawshank Redemption').should('be.visible');
	});

	it('shows movie metadata', () => {
		cy.visit('/movie/tt0111161', authSetup);
		cy.wait('@movieInfo');
		cy.contains('1994').should('be.visible');
	});

	it('has a Go Home link', () => {
		cy.visit('/movie/tt0111161', authSetup);
		cy.wait('@movieInfo');
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('displays IMDB score', () => {
		cy.visit('/movie/tt0111161', authSetup);
		cy.wait('@movieInfo');
		// imdb_score is 93 (0-100 scale), MediaHeader divides by 10 when >= 10
		cy.contains('9.3').should('be.visible');
	});
	it('keeps search RD deletion clickable beneath a slots-full notification', () => {
		cy.viewport(1440, 800);
		// Preserve the real response; exercise the same 36-row subset as the
		// Windows native-pointer reproduction, with one isolated provider row.
		const releases = ozCapture.response.results.slice(0, 36);
		const existing = releases.find((row) => row.title.includes('Left foreshortening first'))!;
		const providerRow = {
			id: 'CARD455RIGHTMOST',
			hash: existing.hash,
			filename: existing.title,
			bytes: Math.round(existing.fileSize * 1024 * 1024),
			host: 'real-debrid.com',
			split: 0,
			progress: 0,
			status: 'error',
			added: '2026-10-22T00:00:00.000Z',
			links: [],
			speed: 0,
			seeders: 0,
		};
		const deletes: string[] = [];
		const unexpected: string[] = [];
		let resetStorage = true;
		const isolatedAuth = {
			onBeforeLoad(win: Cypress.AUTWindow) {
				authSetup.onBeforeLoad(win);
				if (resetStorage) {
					// Only this isolated Cypress browser's cache, never a provider library.
					win.indexedDB.deleteDatabase('DMMDB');
					win.indexedDB.deleteDatabase('dmm_global_db');
					resetStorage = false;
				}
				for (const name of [
					'Torrentio',
					'Comet',
					'MediaFusion',
					'Peerflix',
					'TorrentsDB',
					'TorrentioTor',
					'CometTor',
					'MediaFusionTor',
					'PeerflixTor',
					'TorrentsDBTor',
				])
					win.localStorage.setItem(`settings:enable${name}`, JSON.stringify(false));
				win.localStorage.setItem('settings:hideRdBlockedTorrents', 'false');
			},
		};
		cy.intercept({ url: '**', middleware: true }, (request) => {
			const outer = new URL(request.url);
			const proxy = outer.pathname.endsWith('/anticors');
			let target = outer;
			if (proxy) {
				try {
					target = new URL(outer.searchParams.get('url')!);
				} catch {
					unexpected.push(request.url);
					request.destroy();
					return;
				}
			}
			if (!proxy && !/(^|\.)real-debrid\.com$/.test(outer.hostname)) return;
			if (!/(^|\.)real-debrid\.com$/.test(target.hostname)) {
				unexpected.push(request.url);
				request.destroy();
				return;
			}
			const headers = {
				'access-control-allow-origin': String(
					request.headers.origin ?? new URL(Cypress.config('baseUrl')!).origin
				),
				'access-control-allow-credentials': 'true',
				'access-control-allow-headers': String(
					request.headers['access-control-request-headers'] ??
						'Authorization,Content-Type'
				),
				'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
				'access-control-expose-headers': 'x-total-count',
			};
			if (request.method === 'OPTIONS') {
				request.reply({ statusCode: 204, headers });
			} else if (request.method === 'GET' && target.pathname === '/rest/1.0/user') {
				request.reply({ statusCode: 200, body: rdUserFixture, headers });
			} else if (request.method === 'GET' && target.pathname === '/rest/1.0/torrents') {
				request.alias = 'card455Library';
				request.reply({
					statusCode: 200,
					body: deletes.length ? [] : [providerRow],
					headers: { ...headers, 'x-total-count': deletes.length ? '0' : '1' },
				});
			} else if (
				request.method === 'POST' &&
				target.pathname === '/rest/1.0/torrents/addMagnet'
			) {
				request.alias = 'card455Slots';
				request.reply({
					statusCode: 509,
					body: { error: 'traffic_exhausted', error_code: 25 },
					headers,
				});
			} else if (
				request.method === 'DELETE' &&
				target.pathname === `/rest/1.0/torrents/delete/${providerRow.id}`
			) {
				request.alias = 'card455Delete';
				deletes.push(providerRow.id);
				request.reply({ statusCode: 204, headers });
			} else {
				unexpected.push(request.url);
				request.destroy();
			}
		});
		cy.intercept('GET', '**/api/info/movie**', { statusCode: 200, body: ozCapture.metadata });
		cy.intercept('GET', '**/api/torrents/movie**', {
			statusCode: 200,
			body: { results: releases },
		}).as('card455Results');
		cy.intercept('**/api/availability/**', (request) => {
			const path = new URL(request.url).pathname;
			if (path.endsWith('/remove') || path.endsWith('/submit')) {
				request.reply({ success: true });
			} else if (path.endsWith('/playable')) {
				request.reply({ cached: releases.map((row) => row.hash) });
			} else if (path.endsWith('/check') || path.endsWith('/check2')) {
				request.reply({
					available: releases.map((row) => ({
						hash: row.hash,
						filename: row.title,
						originalFilename: row.title,
						files: [
							{
								file_id: 1,
								path: `${row.title}.mkv`,
								bytes: Math.round(row.fileSize * 1024 * 1024),
							},
						],
					})),
				});
			} else {
				unexpected.push(request.url);
				request.destroy();
			}
		});
		cy.visit('/library', isolatedAuth);
		cy.wait('@card455Library');
		cy.get('button[title="Delete"]').should('be.visible');
		// The row renders before its asynchronous cache commit. Wait for the
		// actual client write before leaving, as in the native-pointer receipt.
		cy.window().then({ timeout: 15000 }, async (win) => {
			const deadline = Date.now() + 10000;
			while (Date.now() < deadline) {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = win.indexedDB.open('DMMDB');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				try {
					const rows = await new Promise<Array<{ hash: string }>>((resolve, reject) => {
						const request = db
							.transaction('torrents-0')
							.objectStore('torrents-0')
							.getAll();
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					if (rows.some((row) => row.hash === providerRow.hash)) return;
				} finally {
					db.close();
				}
				await new Promise((resolve) => win.setTimeout(resolve, 50));
			}
			throw new Error('The isolated provider row was not committed to the client cache');
		});
		cy.visit('/movie/tt1623205', isolatedAuth);
		cy.wait('@card455Results', { requestTimeout: 30000 });
		cy.reload();
		cy.contains('button', 'RD (0%)', { timeout: 15000 }).should('be.visible');
		cy.window().then((win) => {
			const schedule = win.setTimeout.bind(win);
			// Keep all <=5s timers intact, including the toast's remaining lifetime.
			cy.stub(win, 'setTimeout').callsFake(
				(handler: TimerHandler, delay = 0, ...args: unknown[]) =>
					schedule(handler, delay > 5000 && delay <= 60000 ? 1 : delay, ...args)
			);
		});
		cy.get('div.grid')
			.filter((_, element) => element.children.length === releases.length)
			.children()
			.first()
			.contains('button', 'Instant RD')
			.click();
		cy.wait('@card455Slots');
		cy.contains('[role="status"]', 'RD slots full. Retrying in 5s...', {
			timeout: 180000,
		}).should('be.visible');
		const noticeOverlap = (button: HTMLElement) => {
			const notice = [...button.ownerDocument.querySelectorAll('[role="status"]')].find(
				(node) => node.textContent?.includes('RD slots full. Retrying in 5s...')
			);
			if (!notice) return null;
			const rect = button.getBoundingClientRect();
			const noticeRect = notice.getBoundingClientRect();
			const left = Math.max(rect.left, noticeRect.left);
			const right = Math.min(rect.right, noticeRect.right);
			const top = Math.max(rect.top, noticeRect.top);
			const bottom = Math.min(rect.bottom, noticeRect.bottom);
			return { rect, left, right, top, bottom, overlaps: left < right && top < bottom };
		};
		cy.contains('button', 'RD (0%)').then(($button) => {
			const button = $button[0];
			const win = button.ownerDocument.defaultView!;
			win.scrollBy({
				top: button.getBoundingClientRect().y - (win.innerHeight - 32),
				behavior: 'instant',
			});
		});
		cy.contains('button', 'RD (0%)')
			.should(($button) => {
				expect(
					noticeOverlap($button[0])?.overlaps,
					'visible warning actually overlaps RD delete'
				).to.equal(true);
			})
			.then(($button) => {
				const button = $button[0];
				const overlap = noticeOverlap(button)!;
				expect(
					overlap.overlaps,
					'warning remains over the user point, not waited out'
				).to.equal(true);
				const x = (overlap.left + overlap.right) / 2;
				const y = (overlap.top + overlap.bottom) / 2;
				const hit = button.ownerDocument.elementFromPoint(x, y);
				expect(
					hit === button || button.contains(hit),
					'actual user point reaches RD delete beneath the visible warning'
				).to.equal(true);
				cy.wrap($button).click(x - overlap.rect.x, y - overlap.rect.y, {
					scrollBehavior: false,
				});
			});
		cy.wait('@card455Delete');
		cy.then(() => {
			expect(deletes).to.deep.equal([providerRow.id]);
			expect(unexpected, 'unmodelled provider/proxy requests stay fail-closed').to.deep.equal(
				[]
			);
		});
	});
});
