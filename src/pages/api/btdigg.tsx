import { NextApiRequest, NextApiResponse } from 'next';
import { ElementHandle } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const IGNORED_THRESHOLD = 5;

type SearchResult = {
    title: string;
    fileSize: number;
    magnetLink: string;
    hash: string;
    dolby_vision: boolean;
    hdr10plus: boolean;
    hdr: boolean;
    remux: boolean;
    score: number;
};

export type BtDiggApiResult = {
    searchResults?: SearchResult[];
    errorMessage?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<BtDiggApiResult>) {
    const { search } = req.query;

    if (!search || search instanceof Array) {
        res.status(400).json({ errorMessage: 'Missing "search" query parameter' });
        return;
    }

    const browser = await puppeteer.launch({
        args: [`--proxy-server=socks5://127.0.0.1:9050`],
        headless: true,
    });
    const page = await browser.newPage();

    page.on('error', (err: Error) => {
        console.error(err);
        browser.close();
        res.status(500).json({ errorMessage: 'An error occurred while scraping the Btdigg (1)' });
    });

    // Set up the Cloudflare bypass
    await page.evaluateOnNewDocument(() => {
        // Set the User-Agent header to a common browser user agent
        Object.defineProperty(navigator, 'userAgent', {
            value:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        });
    });

    try {
        let pageNum = 0;
        const finalQuery = `${search.trim()} 2160p`;
        // Navigate to the URL to be scraped
        const searchUrl = `http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/search?q=${encodeURIComponent(finalQuery)}&p=${pageNum}&order=3`;
        await page.goto(searchUrl, {waitUntil: 'networkidle0'});

        let ignoredResults = 0;
        let searchResultsArr: SearchResult[] = [];

        while (pageNum <= 100) {
            console.log(`Scraping page ${pageNum}...`);

            // Select all the search results on the current page
            const searchResults = await page.$$('.one_result');

            // Loop through each search result and extract the desired information
            for (const result of searchResults) {
                const title = await result.$eval(
                    '.torrent_name a',
                    (node: any) => node.textContent.trim()
                );
                console.log(title);
                const fileSizeStr = await result.$eval(
                    '.torrent_size',
                    (node: any) => node.textContent.trim()
                );

                // Ignore results that don't have GB in fileSize
                if (!fileSizeStr.includes('GB')) {
                    ignoredResults++;
                    continue;
                }

                // immediately check if filesize makes sense
                const fileSize = parseFloat(fileSizeStr);
                if (fileSize > 128) {
                    continue;
                }

                // Check if every term in the query (tokenized by space) is contained in the title
                const queryTerms = search.split(' .-()').filter(e => e !== "");
                const containsAllTerms = queryTerms.every((term) =>
                    title.toLowerCase().includes(term.toLowerCase())
                );
                if (!containsAllTerms) {
                    continue;
                }

                const magnetLink = await result.$eval(
                    '.torrent_magnet a',
                    (node: any) => node.href
                );
                const hash = magnetLink.match(/xt=urn:btih:(.*?)&/)[1];

                let remux = /\bremux\b|\bbdrip\b/i.test(title);
                let dolby_vision = /\bDV\b|\bDoVi\b/.test(title);
                let hdr10plus = /\bHDR10plus\b/i.test(title);
                let hdr =
                    remux ||
                    dolby_vision ||
                    hdr10plus ||
                    /\bhdr\b|\bVISIONPLUSHDR\b/i.test(title);

                let score = fileSize;
                if (remux) score += 30;
                if (dolby_vision || hdr10plus) score += 20;
                if (hdr) score += 10;

                let resultObj: SearchResult = {
                    title,
                    fileSize,
                    magnetLink,
                    hash,
                    dolby_vision,
                    hdr10plus,
                    hdr,
                    remux,
                    score,
                };
                searchResultsArr.push(resultObj);
                // Reset ignoredResults counter
                ignoredResults = 0;
            }

            // Stop execution if the last 5 results were ignored
            if (ignoredResults >= IGNORED_THRESHOLD) {
                console.log(`Stopped execution after ${pageNum} pages because the last ${IGNORED_THRESHOLD} results were ignored.`);
                break
            }

            // Try to find the "Next →" link and click it to load the next page of results
            const nextPageLink = await page.$x("//a[contains(text(), 'Next →')]");
            if (nextPageLink.length > 0) {
                await (nextPageLink[0] as ElementHandle<Element>).click();
                pageNum++;
                await page.waitForNavigation({waitUntil: 'networkidle0'});
            } else {
                // No more pages, exit the loop
                break;
            }
        }

        searchResultsArr.sort((a, b) => b.score - a.score);
        res.status(200).json({ searchResults: searchResultsArr });

        await browser.close();
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ errorMessage: 'An error occurred while scraping the Btdigg (2)' });
    }
}
