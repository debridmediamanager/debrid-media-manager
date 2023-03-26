import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { getDeviceCode, getCredentials, saveClientCredentials } from '../../auth';

export default function RdLoginPage() {
    const [verificationUrl, setVerificationUrl] = useState('');
    const [intervalId, setIntervalId] = useState<NodeJS.Timeout | undefined>(undefined);
    const [userCode, setUserCode] = useState('');

    const router = useRouter();

    useEffect(() => {
      const fetchDeviceCode = async () => {
        const deviceCodeResponse = await getDeviceCode();
        if (deviceCodeResponse) {
          setVerificationUrl(deviceCodeResponse.verification_url);
          setUserCode(deviceCodeResponse.user_code);

          const interval = deviceCodeResponse.interval * 1000;
          const deviceCode = deviceCodeResponse.device_code;
          const checkAuthorization = async () => {
            const credentialsResponse = await getCredentials(deviceCode);
            if (credentialsResponse) {
              clearInterval(intervalId!);
              saveClientCredentials(credentialsResponse.client_id, credentialsResponse.client_secret);
              router.push('/');
            }
          };
          const id = setInterval(checkAuthorization, interval);
          setIntervalId(id);
        }
      };
      fetchDeviceCode();

      return () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    }, []);

    const handleAuthorize = () => {
      if (verificationUrl) {
        window.open(verificationUrl, '_blank');
      }
    };

    return (
      <div className="flex flex-col items-center justify-center h-screen">
        {userCode && (
          <p className="mb-4 text-lg font-bold">
            Please click the button and enter this code: <strong>{userCode}</strong>
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
