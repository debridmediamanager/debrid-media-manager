import { useRouter } from 'next/router';

export default function LoginPage() {
  const router = useRouter();

  const handleLogin = () => {
    router.push('/rd/login');
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <button
        className="px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600"
        onClick={handleLogin}
      >
        Login with Real Debrid
      </button>
    </div>
  );
}
