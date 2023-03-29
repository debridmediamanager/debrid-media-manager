import { useCurrentUser } from '@/hooks/auth';

export default function IndexPage() {
  const user = useCurrentUser('/login');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold">{user ? `Hello ${user?.username}` : `Loading...`}</h1>
    </div>
  );
};
