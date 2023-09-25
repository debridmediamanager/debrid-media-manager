import { withAuth } from '@/utils/withAuth';
import { GetServerSideProps } from 'next';
import { Browse, getServerSideProps as gssp } from './[search]';

export const getServerSideProps: GetServerSideProps<any> = gssp;

export default withAuth(Browse);
