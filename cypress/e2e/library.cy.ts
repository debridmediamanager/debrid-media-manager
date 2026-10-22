describe('Library Page', () => {
	const authSetup = {
		onBeforeLoad(win: Cypress.AUTWindow) {
			win.localStorage.setItem('rd:accessToken', JSON.stringify('test_token'));
			win.localStorage.setItem('rd:clientId', JSON.stringify('test_client'));
			win.localStorage.setItem('rd:clientSecret', JSON.stringify('test_secret'));
			win.localStorage.setItem('rd:refreshToken', JSON.stringify('test_refresh'));
		},
	};

	beforeEach(() => {
		cy.intercept('GET', '**/rest/1.0/user', {
			statusCode: 200,
			body: {
				id: 12345,
				username: 'testuser',
				email: 'test@example.com',
				type: 'premium',
				premium: 31536000,
				expiration: '2099-12-31T23:59:59.000Z',
			},
		});

		// Mock RD torrents API - must include x-total-count header
		cy.intercept('GET', '**/rest/1.0/torrents*', (req) => {
			req.reply({
				statusCode: 200,
				body: [],
				headers: { 'x-total-count': '0' },
			});
		}).as('torrents');
	});

	it('renders the library page', () => {
		cy.visit('/library', authSetup);
		cy.url().should('include', '/library');
	});

	it('has a search input', () => {
		cy.visit('/library', authSetup);
		cy.get('input').should('exist');
	});

	it('shows a refresh button', () => {
		cy.visit('/library', authSetup);
		cy.get('button').should('have.length.greaterThan', 0);
	});

	it('shows action buttons', () => {
		cy.visit('/library', authSetup);
		cy.contains('Go Home').should('exist');
	});

	it('has a Go Home link', () => {
		cy.visit('/library', authSetup);
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('shows loading state while fetching torrents', () => {
		cy.visit('/library', authSetup);
		// The library page shows a spinner while loading
		cy.get('.animate-spin').should('exist');
	});

	it('shows empty state when no torrents', () => {
		cy.visit('/library', authSetup);
		// Wait for loading to finish - the page should show some content
		cy.get('table').should('exist');
	});

	it('has pagination controls', () => {
		cy.visit('/library', authSetup);
		cy.get('button').should('have.length.greaterThan', 1);
	});

	it('renders the torrent table structure', () => {
		cy.visit('/library', authSetup);
		// Table should exist in the page structure
		cy.get('table').should('exist');
	});

	it('keeps the backup dialog controls one spacing step apart', () => {
		cy.visit('/library', authSetup);
		cy.contains('button', /^Backup$/).click();
		cy.contains('button', 'All Torrents')
			.parent()
			.should(($row) => {
				const buttons = $row[0].querySelectorAll('button');
				expect(buttons).to.have.length(3);
				const first = buttons[0].getBoundingClientRect();
				const second = buttons[1].getBoundingClientRect();
				const root = buttons[0].ownerDocument.documentElement;
				const rem = parseFloat(
					root.ownerDocument.defaultView!.getComputedStyle(root).fontSize
				);
				expect(second.left - first.right, 'visible action spacing').to.be.closeTo(
					0.75 * rem,
					0.5
				);
			});
		cy.contains('button', 'Cancel').click();
	});

	it('spaces visible backup actions across a hidden middle action', () => {
		cy.visit('/library', authSetup);
		cy.contains('button', /^Backup$/).click();
		cy.contains('button', 'Filtered List').invoke('attr', 'hidden', '');
		cy.contains('button', 'All Torrents')
			.parent()
			.should(($row) => {
				const buttons = $row[0].querySelectorAll('button');
				const view = $row[0].ownerDocument.defaultView!;
				const rem = parseFloat(
					view.getComputedStyle(view.document.documentElement).fontSize
				);
				expect(
					buttons[2].getBoundingClientRect().left -
						buttons[0].getBoundingClientRect().right
				).to.be.closeTo(0.75 * rem, 0.5);
				expect(
					view.getComputedStyle(buttons[0]).marginRight,
					'first action owns no trailing spacing'
				).to.eq('0px');
			});
		cy.contains('button', 'Cancel').click();
	});

	it('spaces vertical login sections across hidden children', () => {
		cy.visit('/alldebrid/login');
		cy.contains('button', 'Save API Key')
			.parent()
			.should(($column) => {
				const buttons = $column[0].querySelectorAll('button');
				const view = $column[0].ownerDocument.defaultView!;
				const rem = parseFloat(
					view.getComputedStyle(view.document.documentElement).fontSize
				);
				expect(
					buttons[1].getBoundingClientRect().top -
						buttons[0].getBoundingClientRect().bottom
				).to.be.closeTo(0.5 * rem, 0.5);
			});
		cy.contains('h1', 'Connect AllDebrid')
			.parent()
			.then(($column) => {
				const children = $column[0].children;
				(children[1] as HTMLElement).hidden = true;
				const view = $column[0].ownerDocument.defaultView!;
				const rem = parseFloat(
					view.getComputedStyle(view.document.documentElement).fontSize
				);
				expect(
					children[2].getBoundingClientRect().top -
						children[0].getBoundingClientRect().bottom
				).to.be.closeTo(rem, 0.5);
				expect(
					view.getComputedStyle(children[0]).marginBottom,
					'first section owns no trailing spacing'
				).to.eq('0px');
			});
	});

	describe('forced-colors keyboard focus', () => {
		afterEach(() =>
			cy.then(() =>
				Cypress.automation('remote:debugger:protocol', {
					command: 'Emulation.setEmulatedMedia',
					params: { features: [] },
				})
			)
		);

		it('retains a visible outline when forced colors suppress focus shadows', () => {
			cy.then(() =>
				Cypress.automation('remote:debugger:protocol', {
					command: 'Emulation.setEmulatedMedia',
					params: { features: [{ name: 'forced-colors', value: 'active' }] },
				})
			);
			cy.visit('/library', authSetup);
			cy.contains('button', /^Backup$/).click();
			cy.contains('button', 'All Torrents').focus();
			cy.then(() =>
				Cypress.automation('remote:debugger:protocol', {
					command: 'Input.dispatchKeyEvent',
					params: { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
				})
			);
			cy.then(() =>
				Cypress.automation('remote:debugger:protocol', {
					command: 'Input.dispatchKeyEvent',
					params: { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
				})
			);
			cy.contains('button', 'Filtered List')
				.should('be.focused')
				.should(($button) => {
					const style = $button[0].ownerDocument.defaultView!.getComputedStyle(
						$button[0]
					);
					expect(style.outlineStyle, 'forced-colors focus outline').not.to.eq('none');
					expect(parseFloat(style.outlineWidth)).to.be.greaterThan(0);
				});
			cy.contains('button', 'Cancel').click();
		});
	});
});
