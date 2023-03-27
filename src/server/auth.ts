import { getToken } from '@/api/realDebrid';
import { GetServerSidePropsContext } from 'next';
import nookies, { setCookie } from 'nookies';

const saveTokens = (ctx: GetServerSidePropsContext, accessToken: string, refreshToken: string, expiresIn: number) => {
  setCookie(ctx, 'accessToken', accessToken, { expires: new Date(Date.now() + expiresIn * 1000) });
  setCookie(ctx, 'refreshToken', refreshToken);
};

export const isAuthenticated = async (ctx: GetServerSidePropsContext) => {
  const cookies = nookies.get(ctx);
  const accessToken = cookies['accessToken'];
  if (accessToken) {
    // Access token is already set, so user is authenticated
    return true;
  }

  const refreshToken = cookies['refreshToken'];
  const clientId = cookies['clientId'];
  const clientSecret = cookies['clientSecret'];

  console.log('ok!!!');
  console.log(refreshToken, clientId, clientSecret);

  if (refreshToken && clientId && clientSecret) {
    // Refresh token is available, so try to get new tokens
    const response = await getToken(clientId, clientSecret, refreshToken);

    if (response) {
      // New tokens obtained, save them and return authenticated
      const { access_token, refresh_token, expires_in } = response;
      saveTokens(ctx, access_token, refresh_token, expires_in);
      return true;
    }
  }

  // User is not authenticated
  return false;
};
