import { BOOT_GUARD_SCRIPT } from '@/utils/bootGuard';
import { LOOKBEHIND_SHIM_SCRIPT } from '@/utils/lookbehindShim';
import { POSTER_PRECONNECT_SCRIPT } from '@/utils/posterPreconnect';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SOCIAL_CARD } from '@/utils/siteMeta';
import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
	return (
		<Html lang="en">
			<Head>
				<meta charSet="UTF-8" />
				<script
					id="dmm-lookbehind-shim"
					dangerouslySetInnerHTML={{ __html: LOOKBEHIND_SHIM_SCRIPT }}
				/>
				<script
					id="dmm-boot-guard"
					dangerouslySetInnerHTML={{ __html: BOOT_GUARD_SCRIPT }}
				/>
				<meta name="description" content={SITE_DESCRIPTION} />
				<meta
					name="keywords"
					content="media manager, digital media, streaming, movies, tv shows, anime"
				/>
				<meta property="og:site_name" content={SITE_NAME} />
				<meta property="og:title" content={SITE_NAME} />
				<meta property="og:description" content={SITE_TAGLINE} />
				<meta property="og:image" content={SOCIAL_CARD.url} />
				<meta property="og:image:width" content={String(SOCIAL_CARD.width)} />
				<meta property="og:image:height" content={String(SOCIAL_CARD.height)} />
				<meta property="og:image:alt" content={SOCIAL_CARD.alt} />
				<meta property="og:type" content="website" />
				<meta name="twitter:card" content="summary_large_image" />
				<meta name="twitter:title" content={SITE_NAME} />
				<meta name="twitter:description" content={SITE_TAGLINE} />
				<meta name="twitter:image" content={SOCIAL_CARD.url} />
				<meta name="author" content="yowmamasita" />
				<meta name="apple-mobile-web-app-title" content="DMM" />
				<meta name="theme-color" content="#1f1f1f" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="application-name" content="DMM" />
				<meta name="format-detection" content="telephone=no" />
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				{/* Google wants a favicon of at least 48 px (a multiple of 48) before it shows one in results */}
				<link
					rel="icon"
					type="image/png"
					sizes="192x192"
					href="/android-chrome-192x192.png"
				/>
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
				<link rel="manifest" href="/site.webmanifest" />
				<script
					id="dmm-poster-preconnect"
					dangerouslySetInnerHTML={{ __html: POSTER_PRECONNECT_SCRIPT }}
				/>
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
