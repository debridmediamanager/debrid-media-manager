declare global {
	namespace Cypress {
		interface Chainable {
			loginWithRealDebrid(token?: string): Chainable<void>;
			loginWithAllDebrid(apiKey: string): Chainable<void>;
			loginWithTorbox(apiKey: string): Chainable<void>;
			clearAuth(): Chainable<void>;
			dismissModals(): Chainable<void>;
		}
	}
}

const PREMIUM_SECONDS = 365 * 24 * 60 * 60;

export const rdUserFixture = {
	id: 12345,
	username: 'testuser',
	email: 'test@example.com',
	points: 100,
	locale: 'en',
	avatar: '',
	type: 'premium',
	premium: PREMIUM_SECONDS,
	expiration: '2099-12-31T23:59:59.000Z',
};

export const authLocalStorage = {
	'rd:accessToken': JSON.stringify('test_token'),
	'rd:clientId': JSON.stringify('test_client'),
	'rd:clientSecret': JSON.stringify('test_secret'),
	'rd:refreshToken': JSON.stringify('test_refresh'),
};

Cypress.Commands.add('loginWithRealDebrid', (token?: string) => {
	const rdToken = token ?? Cypress.env('RD_ACCESS_TOKEN');
	cy.window().then((win) => {
		win.localStorage.setItem('rd:accessToken', JSON.stringify(rdToken));
	});
});

Cypress.Commands.add('loginWithAllDebrid', (apiKey: string) => {
	cy.window().then((win) => {
		win.localStorage.setItem('ad:apiKey', JSON.stringify(apiKey));
	});
});

Cypress.Commands.add('loginWithTorbox', (apiKey: string) => {
	cy.window().then((win) => {
		win.localStorage.setItem('tb:apiKey', JSON.stringify(apiKey));
	});
});

Cypress.Commands.add('clearAuth', () => {
	cy.window().then((win) => {
		win.localStorage.removeItem('rd:accessToken');
		win.localStorage.removeItem('rd:refreshToken');
		win.localStorage.removeItem('rd:clientId');
		win.localStorage.removeItem('rd:clientSecret');
		win.localStorage.removeItem('ad:apiKey');
		win.localStorage.removeItem('tb:apiKey');
	});
});

Cypress.Commands.add('dismissModals', () => {
	cy.get('body').then(($body) => {
		if ($body.find('.fixed.inset-0.z-50').length > 0) {
			cy.get('.fixed.inset-0.z-50')
				.find('button')
				.contains(/cancel|later|close|ok/i)
				.click();
		}
	});
});

export {};
