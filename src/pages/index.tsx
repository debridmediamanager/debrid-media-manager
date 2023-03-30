import { useCurrentUser } from '@/hooks/auth';
import { useRouter } from 'next/router';

export default function IndexPage() {
  const user = useCurrentUser('/login');
  const router = useRouter();

  const handleMyAccountClick = () => {
    router.push('/account');
  };

  const handleMoviesClick = () => {
    router.push('/rd/torrents');
  };

  const handleSearchClick = () => {
    router.push('/search');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      {user ? (
        <>
          <h1 className="text-2xl font-bold mb-4">
            Debrid Movie Manager
          </h1>
          <div className="flex flex-col items-center">
            <p className="text-lg font-bold">
              Welcome back, {user.username}!
            </p>
            <p className="text-lg">
              You are building a 2160p library.
              {/* <a href="">Click to change to 1080p.</a> */}
            </p>
            <div className="flex mt-4">
              <button className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                onClick={handleMyAccountClick}>
                My Account
              </button>
              <button className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                onClick={handleMoviesClick}>
                My Movies
              </button>
              <button className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                onClick={handleSearchClick}>
                Search Movies
              </button>
            </div>
          </div>
        </>
      ) : (
        <h1 className="text-2xl font-bold">
          Debrid Movie Manager - Loading...
        </h1>
      )}
    </div>
  );

};
