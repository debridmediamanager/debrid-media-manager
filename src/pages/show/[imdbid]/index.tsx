import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
	const { params } = context;
	return {
		redirect: {
			destination: `/show/${params?.imdbid}/1`,
			permanent: false,
		},
	};
};

const RedirectPage = () => null;

export default RedirectPage;
