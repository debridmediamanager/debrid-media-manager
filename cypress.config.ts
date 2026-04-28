import { defineConfig } from 'cypress';

export default defineConfig({
	e2e: {
		baseUrl: 'http://localhost:3333',
		viewportWidth: 1280,
		viewportHeight: 800,
		defaultCommandTimeout: 10000,
		pageLoadTimeout: 30000,
		video: false,
		screenshotOnRunFailure: true,
		setupNodeEvents(on, config) {
			// implement node event listeners here
		},
	},
});
