describe('Show Detail Page', () => {
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

		// Mock show info API - response matches actual /api/info/show shape
		cy.intercept('GET', '**/api/info/show**', {
			statusCode: 200,
			body: {
				title: 'Breaking Bad',
				description: 'A chemistry teacher turns to manufacturing methamphetamine.',
				poster: '',
				backdrop: '',
				season_count: 5,
				season_names: ['Season 1', 'Season 2', 'Season 3', 'Season 4', 'Season 5'],
				has_specials: false,
				imdb_score: 95,
				season_episode_counts: { 1: 7, 2: 13, 3: 13, 4: 13, 5: 16 },
				trailer: '',
			},
		}).as('showInfo');
	});

	it('renders the show detail page', () => {
		// /show/[imdbid] redirects to /show/[imdbid]/1
		cy.visit('/show/tt0903747', authSetup);
		cy.wait('@showInfo');
		cy.contains('Breaking Bad').should('be.visible');
	});

	it('shows season information', () => {
		cy.visit('/show/tt0903747', authSetup);
		cy.wait('@showInfo');
		cy.contains('Season').should('be.visible');
	});

	it('displays IMDB score', () => {
		cy.visit('/show/tt0903747', authSetup);
		cy.wait('@showInfo');
		// imdb_score is 95 (0-100 scale), MediaHeader divides by 10 when >= 10
		cy.contains('9.5').should('be.visible');
	});

	it('has a Go Home link', () => {
		cy.visit('/show/tt0903747', authSetup);
		cy.wait('@showInfo');
		cy.contains('Go Home').should('be.visible').and('have.attr', 'href', '/');
	});
});
