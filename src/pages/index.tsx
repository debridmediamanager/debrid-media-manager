import { useRequireAuth } from '@/hooks/auth';

export default function IndexPage() {
  useRequireAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold">Hello world!</h1>
    </div>
  );
};
