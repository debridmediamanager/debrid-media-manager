import axios from 'axios';
import Cookies from 'js-cookie';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
  direct_verification_url: string;
}

interface CredentialsResponse {
  client_id: string;
  client_secret: string;
}

const saveClientCredentials = (clientId: string, clientSecret: string) => {
  Cookies.set('clientId', clientId);
  Cookies.set('clientSecret', clientSecret);
};

const getDeviceCode = async () => {
  try {
    const response = await axios.get<DeviceCodeResponse>(
      'https://api.real-debrid.com/oauth/v2/device/code',
      {
        params: {
          client_id: 'X245A4XAIBGVM',
          new_credentials: 'yes',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching device code:', (error as any).message);
    return null;
  }
};

const getCredentials = async (deviceCode: string) => {
  try {
    const response = await axios.get<CredentialsResponse>(
      'https://api.real-debrid.com/oauth/v2/device/credentials',
      {
        params: {
          client_id: 'X245A4XAIBGVM',
          code: deviceCode,
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error fetching credentials:', error.message);
    return null;
  }
};

const isAuthenticated = async () => {
  const clientId = Cookies.get('clientId');
  const clientSecret = Cookies.get('clientSecret');
  return Boolean(clientId && clientSecret);
};

export const useRequireAuth = () => {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const authenticated = await isAuthenticated();
      if (!authenticated) {
        router.push('/login');
      }
    };
    checkAuth();
  }, [router]);
};

export const useLogin = () => {
  const router = useRouter();

  const handleLogin = async () => {
    await router.push('/rd/login');
  };

  return { handleLogin };
};

export const useAuthorization = () => {
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
  }, [router]);

  const handleAuthorize = () => {
    if (verificationUrl) {
      window.open(verificationUrl, '_blank');
    }
  };

  return { userCode, handleAuthorize };
};
