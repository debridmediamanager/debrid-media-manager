import { hasNoBannedTerms, matchesTitle } from '@/utils/checks';
import { NextApiHandler } from 'next';

const handler: NextApiHandler = async (req, res) => {
    function testMatchesTitle() {
        let testTitle = "[RapidZona.com]_Duh Chudes OVA 1_ Spirit of Wonder_Miss China's Ring.1992.RUS.JAP.DVDRip.mkv"
        let targetTitle = "spirit of wonder miss china's ring"
        let year = "1992"


        console.log(matchesTitle(targetTitle, year, testTitle))
        console.log(hasNoBannedTerms(targetTitle, testTitle))

        testTitle = "(shinsuV2) Final Fantasy VII Advent Children BRrip 1080p (x265+TrueHD)(spa-ger-jap).mkv"

        console.log(matchesTitle(targetTitle, year, testTitle))
        console.log(hasNoBannedTerms(targetTitle, testTitle))

        testTitle = "Final Fantasy VII Advent Children [BDRip 1080p Eng Jap   Sub Ita Eng]"

        console.log(matchesTitle(targetTitle, year, testTitle))
        console.log(hasNoBannedTerms(targetTitle, testTitle))
    }

    testMatchesTitle();

	res.status(200).json({ status: 'ok' });
};

export default handler;
