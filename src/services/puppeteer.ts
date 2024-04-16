// import { Browser } from 'puppeteer';
// import puppeteer from 'puppeteer-extra';
// import stealth from 'puppeteer-extra-plugin-stealth';

// const options = {
// 	headless: true,
// 	ignoreHTTPSErrors: true,
// 	args: [
// 		'--no-sandbox',
// 		'--disable-setuid-sandbox',
// 		'--disable-sync',
// 		'--ignore-certificate-errors',
// 		'--lang=en-US,en;q=0.9',
// 	],
// 	defaultViewport: { width: 1366, height: 768 },
// };

// export class ScrapeBrowser {
// 	public browser: Browser | null = null;

// 	async launch() {
// 		this.browser = await puppeteer.use(stealth()).launch(options);
// 	}

// 	async close() {
// 		if (this.browser) await this.browser.close();
// 	}
// }
