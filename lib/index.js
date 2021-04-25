import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import CryptoJSCore from 'crypto-js/core';
import AES from 'crypto-js/aes';
import uuidv4 from 'uuid/v4';

export const DocumentDir = FileSystem.documentDirectory;
export const CacheDir = FileSystem.cacheDirectory;

const resolvePath = (...paths) => paths.join('/').split('/').filter(part => part && part !== '.').join('/');

// Wrap function to support both Promise and callback
async function withCallback(callback, func) {
  try {
    const result = await func();
    if (callback) {
      callback(null, result);
    }
    return result;
  } catch (err) {
    if (callback) {
      callback(err);
    } else {
      throw err;
    }
  }
}

const ENCRYPTION_KEY = 'expoFsSecureEncryptionKey';

let encryptionKey = null;
const FSStorage = (location = DocumentDir, folder = 'reduxPersist') => {
  const baseFolder = resolvePath(location, folder);

  const pathForKey = key => resolvePath(baseFolder, encodeURIComponent(key));

  const getEncryptionKey = async () => {
    try {
      if (encryptionKey == null) {
        let encryptionKeyValue = await SecureStore.getItemAsync(ENCRYPTION_KEY);

        if (!encryptionKeyValue) {
          encryptionKeyValue = uuidv4();
          await SecureStore.setItemAsync(ENCRYPTION_KEY, encryptionKeyValue);
        }

        encryptionKey = encryptionKeyValue;
      }

      return encryptionKey;
    } catch (err) {
      throw new Error(`Error getting encryption key ${err.message}`);
    }
  };

  const setItem = (key, value, callback) => withCallback(callback, async () => {
    try {
      const { exists } = await FileSystem.getInfoAsync(baseFolder);

      if (exists == false) {
        await FileSystem.makeDirectoryAsync(baseFolder, {
          intermediates: true
        });
      }

      let encryptedValue = value;
      const secretKey = await getEncryptionKey();

      encryptedValue = AES.encrypt(value, secretKey).toString();
      await FileSystem.writeAsStringAsync(pathForKey(key), encryptedValue);
    } catch (err) {
      throw new Error(`Error setting item: ${err.message}`);
    }
  });

  const getItem = (key, callback) => withCallback(callback, async () => {
    const pathKey = pathForKey(key);
    const { exists } = await FileSystem.getInfoAsync(pathKey);

    if (exists) {
      try {
        let decryptedString = "{}";
        const encryptedValue = await FileSystem.readAsStringAsync(pathKey);

        try {
          const secretKey = await getEncryptionKey();
          const bytes = AES.decrypt(encryptedValue, secretKey);

          decryptedString = bytes.toString(CryptoJSCore.enc.Utf8);
        } catch (err) {
          throw new Error(`Could not decrypt state: ${err.message}`);
        }

        return decryptedString;
      } catch (err) {
        throw new Error(`Error getting item: ${err.message}`);
      }
    }
  });

  const removeItem = (key, callback) => withCallback(callback, async () => {
    await FileSystem.deleteAsync(pathForKey(key), {
      idempotent: true
    });
  });

  const getAllKeys = callback => withCallback(callback, async () => {
    await FileSystem.makeDirectoryAsync(baseFolder, {
      intermediates: true
    });

    const files = await FileSystem.readDirectoryAsync(baseFolder);
    return files.map(fileUri => decodeURIComponent(fileUri));
  });

  return {
    setItem,
    getItem,
    removeItem,
    getAllKeys
  };
};

export default FSStorage;
