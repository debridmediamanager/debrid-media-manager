describe('Start Page (Unauthenticated)', () => {
	beforeEach(() => {
		cy.clearLocalStorage();
		cy.visit('/start');
	});

	it('renders the welcome heading and logo', () => {
		cy.contains('h1', 'Welcome to Debrid Media Manager').should('be.visible');
		cy.get('svg').should('exist');
	});

	it('shows login buttons for all three debrid services', () => {
		cy.contains('button', 'Login with Real Debrid').should('be.visible');
		cy.contains('button', 'Login with AllDebrid').should('be.visible');
		cy.contains('button', 'Login with Torbox').should('be.visible');
	});

	it('shows sign-up links for all three debrid services', () => {
		cy.contains('a', 'Create an account with RealDebrid').should(
			'have.attr',
			'target',
			'_blank'
		);
		cy.contains('a', 'Create an account with AllDebrid').should(
			'have.attr',
			'target',
			'_blank'
		);
		cy.contains('a', 'Create an account with Torbox').should('have.attr', 'target', '_blank');
	});

	it('shows data storage policy', () => {
		cy.contains('Data Storage Policy').should('be.visible');
		cy.contains('no data or logs are stored on our servers').should('be.visible');
	});

	it('shows open source link', () => {
		cy.contains('a', 'open source').should('have.attr', 'target', '_blank');
	});

	it('navigates to Real Debrid login on button click', () => {
		cy.contains('button', 'Login with Real Debrid').click();
		cy.url().should('include', '/realdebrid/login');
	});

	it('navigates to AllDebrid login on button click', () => {
		cy.contains('button', 'Login with AllDebrid').click();
		cy.url().should('include', '/alldebrid/login');
	});

	it('navigates to Torbox login on button click', () => {
		cy.contains('button', 'Login with Torbox').click();
		cy.url().should('include', '/torbox/login');
	});
});
