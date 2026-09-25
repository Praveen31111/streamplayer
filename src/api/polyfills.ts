// Polyfills for React Native (Hermes / JSC) & Expo Go environment
import { Platform } from 'youtubei.js';

// 1. YouTube Decipher Script Evaluator & Server Environment Emulation
try {
  Platform.shim.server = true;
  Platform.shim.eval = (data: any) => {
    const code = typeof data === 'string' ? data : (data?.output || '');
    const fn = new Function(code);
    return fn();
  };

  const originalShimFetch = Platform.shim.fetch;
  Platform.shim.fetch = (input: any, init: any = {}) => {
    let headers: Headers;
    if (init && init.headers) {
      headers = new Headers(init.headers);
    } else if (typeof Request !== 'undefined' && input instanceof Request) {
      headers = new Headers(input.headers);
    } else {
      headers = new Headers();
    }

    if (!headers.has('User-Agent')) {
      headers.set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      );
    }
    if (!headers.has('Origin')) {
      headers.set('Origin', 'https://www.youtube.com');
    }
    if (!headers.has('Referer')) {
      headers.set('Referer', 'https://www.youtube.com/');
    }

    return originalShimFetch(input, { ...init, headers });
  };
} catch {
  // Ignored
}

// 2. Mock MMKV Storage for youtubei.js
if (typeof (globalThis as any).mmkvStorage !== 'function') {
  (globalThis as any).mmkvStorage = class MockMMKVStorage {
    private map = new Map<string, Uint8Array>();
    getBuffer(key: string) {
      const val = this.map.get(key);
      return val ? { buffer: val.buffer } : null;
    }
    set(key: string, value: Uint8Array) {
      this.map.set(key, value);
    }
    delete(key: string) {
      this.map.delete(key);
    }
  };
}

// 3. CustomEvent Polyfill
if (typeof (globalThis as any).CustomEvent !== 'function') {
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, options: any = {}) {
      this.type = type;
      this.detail = options.detail || null;
    }
  };
}

// 4. Crypto fallback if missing
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = {};
}
if (typeof (globalThis as any).crypto.randomUUID !== 'function') {
  (globalThis as any).crypto.randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}
if (typeof (globalThis as any).crypto.getRandomValues !== 'function') {
  (globalThis as any).crypto.getRandomValues = (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  };
}
