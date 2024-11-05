import axios from 'axios';
import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
	const mdblistKey = process.env.MDBLIST_KEY;
	const getMdbInfo = (imdbId: string) =>
		`https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
	const imdbId = context.params!.imdbid as string;

	try {
		const resp = await axios.get(getMdbInfo(imdbId));

		// If no poster or invalid poster URL
		if (!resp.data.poster || !resp.data.poster.startsWith('http')) {
			return {
				notFound: true,
			};
		}

		// Valid poster URL found
		return {
			redirect: {
				destination: resp.data.poster,
				permanent: false,
			},
		};
	} catch (error) {
		// If API call fails, redirect to the main page for that ID
		return {
			redirect: {
				destination: `/movie/${imdbId}`,
				permanent: false,
			},
		};
	}
};

export default function Mdblist() {
	return <></>;
}
