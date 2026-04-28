describe('Real Debrid Login Page', () => {
	beforeEach(() => {
		cy.clearLocalStorage();
	});

	it('displays a verification URL when device code is received', () => {
		cy.intercept('GET', '**/device/code*', {
			statusCode: 200,
			body: {
				device_code: 'test_device_code',
				user_code: 'ABCD1234',
				interval: 5,
				expires_in: 600,
				verification_url: 'https://real-debrid.com/device',
				direct_verification_url: 'https://real-debrid.com/device?code=ABCD1234',
			},
		}).as('deviceCode');

		cy.visit('/realdebrid/login');
		cy.wait('@deviceCode');
		cy.contains('ABCD1234').should('be.visible');
	});
});

describe('AllDebrid Login Page', () => {
	beforeEach(() => {
		cy.clearLocalStorage();
	});

	it('renders the AllDebrid login page', () => {
		cy.visit('/alldebrid/login');
		cy.url().should('include', '/alldebrid/login');
	});
});

describe('Torbox Login Page', () => {
	beforeEach(() => {
		cy.clearLocalStorage();
	});

	it('renders the Torbox login page', () => {
		cy.visit('/torbox/login');
		cy.url().should('include', '/torbox/login');
	});
});
