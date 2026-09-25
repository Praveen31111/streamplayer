import { getYouTubeClient } from '../api/youtubeClient';
import { saveCredentials, removeCredentials, getStoredCredentials } from './authStorage';

export interface AuthPromptData {
  userCode: string;
  verificationUrl: string;
}

export const checkIsLoggedIn = async (): Promise<boolean> => {
  const creds = await getStoredCredentials();
  return !!creds;
};

export const startGoogleSignIn = async (
  onAuthPending: (data: AuthPromptData) => void,
  onSuccess: () => void,
  onError: (error: any) => void
): Promise<void> => {
  try {
    const yt = await getYouTubeClient();

    yt.session.on('auth-pending', (data: any) => {
      onAuthPending({
        userCode: data.user_code,
        verificationUrl: data.verification_url,
      });
    });

    yt.session.on('auth', async (data: any) => {
      await saveCredentials(data.credentials);
      onSuccess();
    });

    yt.session.on('auth-error', (err: any) => {
      onError(err);
    });

    await yt.session.signIn();
  } catch (err) {
    onError(err);
  }
};

export const signOutGoogle = async (): Promise<void> => {
  try {
    const yt = await getYouTubeClient();
    await yt.session.signOut();
    await removeCredentials();
  } catch (error) {
    console.error('Error signing out:', error);
    await removeCredentials();
  }
};
