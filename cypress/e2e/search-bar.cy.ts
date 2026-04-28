describe('Search Bar', () => {
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

	it('shows autocomplete suggestions on typing', () => {
		// SearchBar uses /api/trakt/search, returns Trakt-format results
		cy.intercept('GET', '**/api/trakt/search**', {
			statusCode: 200,
			body: [
				{
					type: 'movie',
					score: 10,
					movie: {
						title: 'The Shawshank Redemption',
						ids: { imdb: 'tt0111161' },
					},
				},
			],
		}).as('suggestions');

		cy.visit('/', authSetup);
		cy.get('input').first().type('shawshank');
		cy.wait('@suggestions');
		cy.contains('The Shawshank Redemption').should('be.visible');
	});

	it('navigates to movie on suggestion click', () => {
		cy.intercept('GET', '**/api/trakt/search**', {
			statusCode: 200,
			body: [
				{
					type: 'movie',
					score: 10,
					movie: {
						title: 'The Shawshank Redemption',
						ids: { imdb: 'tt0111161' },
					},
				},
			],
		}).as('suggestions');

		// Mock movie info for the detail page
		cy.intercept('GET', '**/api/info/movie**', {
			statusCode: 200,
			body: {
				title: 'The Shawshank Redemption',
				description: 'Two imprisoned men bond.',
				poster: '',
				backdrop: '',
				year: '1994',
				imdb_score: 93,
				trailer: '',
			},
		});

		cy.visit('/', authSetup);
		cy.get('input').first().type('shawshank');
		cy.wait('@suggestions');
		cy.contains('The Shawshank Redemption').click();
		cy.url().should('include', '/movie/tt0111161');
	});

	it('submits search form on enter', () => {
		cy.visit('/', authSetup);
		cy.get('input').first().type('test query{enter}');
		cy.url().should('include', '/search');
	});

	it('redirects to movie page for IMDB ID input', () => {
		cy.intercept('GET', '**/api/info/movie**', {
			statusCode: 200,
			body: {
				title: 'The Shawshank Redemption',
				description: 'Two imprisoned men bond.',
				poster: '',
				backdrop: '',
				year: '1994',
				imdb_score: 93,
				trailer: '',
			},
		});

		cy.visit('/', authSetup);
		cy.get('input').first().type('tt0111161{enter}');
		cy.url().should('include', 'tt0111161');
	});

	it('hides suggestions when clicking elsewhere', () => {
		cy.intercept('GET', '**/api/trakt/search**', {
			statusCode: 200,
			body: [
				{
					type: 'movie',
					score: 10,
					movie: {
						title: 'The Shawshank Redemption',
						ids: { imdb: 'tt0111161' },
					},
				},
			],
		}).as('suggestions');

		cy.visit('/', authSetup);
		cy.get('input').first().type('shawshank');
		cy.wait('@suggestions');
		cy.contains('The Shawshank Redemption').should('be.visible');
		cy.get('body').click(0, 0);
		cy.contains('The Shawshank Redemption').should('not.exist');
	});

	it('shows empty state when no results', () => {
		cy.intercept('GET', '**/api/trakt/search**', {
			statusCode: 200,
			body: [],
		}).as('emptySearch');

		cy.visit('/', authSetup);
		cy.get('input').first().type('xyznonexistent');
		cy.wait('@emptySearch');
	});
});
