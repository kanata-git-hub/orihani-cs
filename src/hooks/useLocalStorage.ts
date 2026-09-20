import { scopedStorage } from '../accountStorage';
import { auth } from '../firebase';
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  const [storage] = useState(() => scopedStorage(localStorage, auth.currentUser?.uid || null));
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = storage.getItem(key);
      if (item !== null) {
        try {
          return JSON.parse(item);
        } catch {
          // Fallback for strings that weren't JSON.stringified
          return item as unknown as T;
        }
      }
      return initialValue;
    } catch (error) {
      console.warn('Error reading localStorage', error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (storedValue === undefined) {
        storage.removeItem(key);
      } else {
        const valueToStore = typeof storedValue === 'string' ? storedValue : JSON.stringify(storedValue);
        storage.setItem(key, valueToStore);
      }
    } catch (error) {
      console.warn('Error setting localStorage', error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}
