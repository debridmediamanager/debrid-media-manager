import { useRealDebridAuthorization } from "@/hooks/auth";

export default function RealDebridLoginPage() {
    const { userCode, handleAuthorize } = useRealDebridAuthorization();

    return (
      <div className="flex flex-col items-center justify-center h-screen">
        {userCode && (
          <p className="mb-4 text-lg font-bold">
            Please click the button and enter this code: <strong>{userCode}</strong> (copied to your clipboard)
          </p>
        )}
        <button
          className="px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600"
          onClick={handleAuthorize}
        >
          Authorize Debrid Torrent Manager
        </button>
      </div>
    );
  }
