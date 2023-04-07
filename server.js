// NOT NEEDED ANYMORE

const express = require('express');
const next = require('next');
const puppeteer = require('puppeteer');

(async () => {
    const browsersQty = process.env.BROWSERS_QTY ? parseInt(process.env.BROWSERS_QTY, 10) : 1;
    const browserPromises = [];
    for (let i = 0; i < browsersQty; i++) {
        const port = 9222 + i;
        const browserPromise = puppeteer.launch({
            args: [
                `--proxy-server=socks5://127.0.0.1:9050`,
                `--remote-debugging-port=${port}`,
            ],
            headless: true,
        });
        browserPromises.push(browserPromise);
    }
    const browsers = await Promise.all(browserPromises);
    console.log(`Launched ${browsers.length} browsers`);

    const app = next({ dev: process.env.ENV === 'development' });
    const handler = app.getRequestHandler();
    await app.prepare();
    const server = express();
    server.all('*', handler);
    server.listen(process.env.PORT || 3000);
})();
