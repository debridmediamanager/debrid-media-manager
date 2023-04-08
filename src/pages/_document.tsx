import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
	return (
		<Html lang="en">
			<Head>
				<title>Debrid Media Manager</title>
				<meta charSet="UTF-8" />
				<meta name="description" content="This is my personal website." />
				<meta name="keywords" content="personal, website, blog" />
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
