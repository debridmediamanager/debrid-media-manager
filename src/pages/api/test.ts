import { hasNoBannedTerms, matchesTitle } from '@/utils/checks';
import { NextApiHandler } from 'next';

const handler: NextApiHandler = async (req, res) => {
	function testMatchesTitle() {
		let testTitle = '[New-raws] Kizuna no Allele - 01~12 [1080p] [ENG]';
		let targetTitle = "Doraemon: Nobita's Dinosaur";
		let years = ['2006'];

		console.log(matchesTitle(targetTitle, years, testTitle));
		console.log(hasNoBannedTerms(targetTitle, testTitle));

		testTitle =
			'Non Non Biyori The Movie Vacation 2018 1080p Blu-ray Remux AVC LPCM 5.1 - MH93.mkv';
		targetTitle = 'Non Non Biyori: Vacation';
		years = ['2018'];

		console.log(matchesTitle(targetTitle, years, testTitle));
		console.log(hasNoBannedTerms(targetTitle, testTitle));
	}

	testMatchesTitle();

	res.status(200).json({ status: 'ok' });
};

export default handler;
