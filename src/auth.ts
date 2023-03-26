import axios from 'axios';
import Cookies from 'js-cookie';

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

export const saveClientCredentials = (clientId: string, clientSecret: string) => {
  Cookies.set('clientId', clientId);
  Cookies.set('clientSecret', clientSecret);
};

export const isAuthenticated = async () => {
  // Check if the user is authenticated
  const clientId = Cookies.get('clientId');
  const clientSecret = Cookies.get('clientSecret');
  return Boolean(clientId && clientSecret);
};


export const getDeviceCode = async () => {
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

export const getCredentials = async (deviceCode: string) => {
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
