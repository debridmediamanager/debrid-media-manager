describe('Calendar Page', () => {
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
	});

	it('renders the calendar page', () => {
		cy.visit('/calendar', authSetup);
		cy.url().should('include', '/calendar');
	});

	it('has a search input', () => {
		cy.visit('/calendar', authSetup);
		cy.get('input').should('exist');
	});

	it('shows the page title', () => {
		cy.visit('/calendar', authSetup);
		cy.contains('Calendar').should('be.visible');
	});

	it('has a Go Home link', () => {
		cy.visit('/calendar', authSetup);
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});

	it('displays episode information when available', () => {
		const today = new Date().toISOString().slice(0, 10);

		cy.intercept('GET', '**/api/calendar*', {
			statusCode: 200,
			body: {
				range: { start: today, days: 7 },
				days: [
					{
						date: today,
						items: [
							{
								title: 'Breaking Bad',
								season: 1,
								episode: 1,
								firstAired: new Date().toISOString(),
								isPremiere: false,
								source: 'trakt',
								ids: { imdb: 'tt0903747' },
							},
						],
					},
				],
				tmdb: { airingToday: [], onTheAir: [] },
			},
		}).as('calendarData');

		cy.visit('/calendar', authSetup);
		cy.wait('@calendarData');
		cy.contains('Breaking Bad').should('be.visible');
	});
});
