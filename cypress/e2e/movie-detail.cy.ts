describe('Movie Detail Page', () => {
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
});
