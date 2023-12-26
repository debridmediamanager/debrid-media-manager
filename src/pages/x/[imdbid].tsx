import axios from 'axios';
import { GetServerSideProps } from 'next';

const mdblistKey = process.env.MDBLIST_KEY;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;

export const getServerSideProps: GetServerSideProps = async (context) => {
	const imdbId = context.params!.imdbid as string;
	const resp = await axios.get(getMdbInfo(imdbId));
	return {
		redirect: {
			destination: `/${resp.data.type}/${imdbId}`,
			permanent: true,
		},
	};
};

export default function Mdblist() {
	return <></>;
}
