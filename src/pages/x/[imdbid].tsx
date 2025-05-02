import { getMdblistClient } from '@/services/mdblistClient';
import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
	const mdblistClient = getMdblistClient();
	const imdbId = context.params!.imdbid as string;
	const resp = await mdblistClient.getInfoByImdbId(imdbId);
	return {
		redirect: {
			destination: `/${resp.type}/${imdbId}`,
			permanent: true,
		},
	};
};

export default function Mdblist() {
	return <></>;
}
