import { getCredentials, getCurrentUser, getDeviceCode } from '@/api/realDebrid';
import Cookies from 'js-cookie';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  points: number;
  locale: string;
  avatar: string;
  type: 'premium' | 'free';
  premium: number;
  expiration: string;
}

const saveClientCredentials = (clientId: string, clientSecret: string, deviceCode: string) => {
  Cookies.set('clientId', clientId);
  Cookies.set('clientSecret', clientSecret);
  Cookies.set('refreshToken', deviceCode);
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
  const [intervalId, setIntervalId] = useState<number | undefined>(undefined);
  const [userCode, setUserCode] = useState('');

  useEffect(() => {
    const fetchDeviceCode = async () => {
      const deviceCodeResponse = await getDeviceCode();
      if (deviceCodeResponse) {
        setVerificationUrl(deviceCodeResponse.verification_url);
        setUserCode(deviceCodeResponse.user_code);

        // Save user code to clipboard
        try {
          await navigator.clipboard.writeText(deviceCodeResponse.user_code);
        } catch (error) {
          console.error('Error saving user code to clipboard:', (error as any).message);
        }

        const interval = deviceCodeResponse.interval * 1000;
        const deviceCode = deviceCodeResponse.device_code;

        const checkAuthorization = async () => {
          const credentialsResponse = await getCredentials(deviceCode);
          if (credentialsResponse) {
            clearInterval(intervalId!);
            saveClientCredentials(credentialsResponse.client_id, credentialsResponse.client_secret, deviceCode);
            // instead of router.push('/') let's do a hard route refresh
            // because of issues on:
            // 1: interval not being cancelled
            // 2: initial user fetch failing on client route change
            window.location.href = '/';
          }
        };

        const id = setInterval(checkAuthorization, interval) as any as number;
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

  return { userCode, handleAuthorize };
};

export const useCurrentUser = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const accessToken = Cookies.get('accessToken');
      const currentUser = await getCurrentUser(accessToken!);
      if (currentUser) {
        setUser(<User>currentUser);
      }
    };
    fetchUser();
  }, []);

  return user;
};
