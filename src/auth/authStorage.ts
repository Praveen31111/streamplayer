import * as SecureStore from 'expo-secure-store';

const AUTH_KEY = 'yt_auth_credentials';

export const saveCredentials = async (credentials: any): Promise<void> => {
  try {
    await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(credentials));
  } catch (error) {
    console.error('Error saving credentials to SecureStore:', error);
  }
};

export const getStoredCredentials = async (): Promise<any | null> => {
  try {
    const data = await SecureStore.getItemAsync(AUTH_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error reading credentials from SecureStore:', error);
    return null;
  }
};

export const removeCredentials = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(AUTH_KEY);
  } catch (error) {
    console.error('Error removing credentials from SecureStore:', error);
  }
};
