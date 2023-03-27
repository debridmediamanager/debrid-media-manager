import { useCurrentUser } from '@/hooks/auth';
import { isAuthenticated } from '@/server/auth';
import { GetServerSideProps } from 'next';

export default function IndexPage() {
  const user = useCurrentUser();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold">Hello {user?.username}!</h1>
    </div>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const authenticated = await isAuthenticated(context);
  if (!authenticated) {
    context.res.writeHead(302, { Location: '/login' });
    context.res.end();
  }

  return {
    props: {}, // Pass any needed props here
  };
};
