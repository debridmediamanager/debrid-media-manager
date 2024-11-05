import axios from 'axios';
import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
	const mdblistKey = process.env.MDBLIST_KEY;
	const getMdbInfo = (imdbId: string) =>
		`https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
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
