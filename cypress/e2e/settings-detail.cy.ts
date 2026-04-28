describe('Settings Detail', () => {
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

	it('shows torrent source toggles', () => {
		cy.visit('/settings', authSetup);
		cy.get('input[type="checkbox"]').should('have.length.greaterThan', 0);
	});

	it('has size limit inputs', () => {
		cy.visit('/settings', authSetup);
		cy.get('input[type="number"], input[type="range"]').should('have.length.greaterThan', 0);
	});

	it('toggles a checkbox', () => {
		cy.visit('/settings', authSetup);
		cy.get('input[type="checkbox"]').first().click();
	});

	it('shows player setting', () => {
		cy.visit('/settings', authSetup);
		cy.get('select, input[type="radio"], [role="radiogroup"]').should('exist');
	});

	it('persists settings after page reload', () => {
		cy.visit('/settings', authSetup);
		cy.get('input[type="checkbox"]').first().as('firstCheckbox');
		cy.get('@firstCheckbox')
			.invoke('prop', 'checked')
			.then((initialState) => {
				cy.get('@firstCheckbox').click();
				cy.reload();
				cy.get('input[type="checkbox"]')
					.first()
					.invoke('prop', 'checked')
					.should('not.eq', initialState);
			});
	});
});
