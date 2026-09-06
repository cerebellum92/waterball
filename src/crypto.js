// Native Web Crypto API (AES-256-GCM) Local Secret Protection for Waterball

const SEED_STORAGE_KEY = 'bbsterm_crypto_seed_v1';

async function getOrCreateKey() {
  let seed = localStorage.getItem(SEED_STORAGE_KEY);
  if (!seed) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    seed = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SEED_STORAGE_KEY, seed);
  }

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(seed),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const salt = enc.encode('waterball-bbs-local-salt');
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufferToBase64(buf) {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return btoa(bin);
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encrypt a secret string using AES-256-GCM.
 * Output format: "enc:v1:<iv_b64>:<ciphertext_b64>"
 */
export async function encryptSecret(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return '';
  if (plaintext.startsWith('enc:v1:')) return plaintext; // Already encrypted

  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encryptedBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );

    const ivB64 = bufferToBase64(iv);
    const cipherB64 = bufferToBase64(encryptedBuf);
    return `enc:v1:${ivB64}:${cipherB64}`;
  } catch (err) {
    console.error('Encryption failed:', err);
    return plaintext;
  }
}

/**
 * Decrypt a secret string using AES-256-GCM.
 * If not in encrypted format, returns plaintext as-is (backward compatible).
 */
export async function decryptSecret(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return '';
  if (!ciphertext.startsWith('enc:v1:')) {
    return ciphertext; // Plaintext fallback
  }

  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) return '';
    const iv = base64ToBuffer(parts[2]);
    const cipherBuf = base64ToBuffer(parts[3]);

    const key = await getOrCreateKey();
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      cipherBuf
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuf);
  } catch (err) {
    console.error('Decryption failed:', err);
    return '';
  }
}

/**
 * Remove legacy AES crypto seed from localStorage once migrated to native vault.
 */
export function removeLegacyCryptoSeed() {
  try {
    localStorage.removeItem(SEED_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to remove legacy crypto seed:', e);
  }
}

/**
 * Save credential into OS Native Keyring / Restricted File Vault
 */
export async function secureSaveCredential(key, secret) {
  if (!key) return;
  if (!secret) {
    return secureDeleteCredential(key);
  }
  if (window.__TAURI__?.core?.invoke) {
    try {
      await window.__TAURI__.core.invoke('secure_save_credential', { key, secret });
      return;
    } catch (err) {
      console.error('Tauri secure_save_credential failed, falling back to local encryption:', err);
    }
  }
  // Browser/Web fallback
  const enc = await encryptSecret(secret);
  localStorage.setItem(`__sec_${key}`, enc);
}

/**
 * Get credential from OS Native Keyring / Restricted File Vault
 */
export async function secureGetCredential(key) {
  if (!key) return '';
  if (window.__TAURI__?.core?.invoke) {
    try {
      const res = await window.__TAURI__.core.invoke('secure_get_credential', { key });
      if (res !== null && res !== undefined) {
        return res;
      }
    } catch (err) {
      console.error('Tauri secure_get_credential failed, trying local fallback:', err);
    }
  }
  // Browser/Web fallback
  const stored = localStorage.getItem(`__sec_${key}`);
  if (stored) {
    return await decryptSecret(stored);
  }
  return '';
}

/**
 * Delete credential from OS Native Keyring / Restricted File Vault
 */
export async function secureDeleteCredential(key) {
  if (!key) return;
  if (window.__TAURI__?.core?.invoke) {
    try {
      await window.__TAURI__.core.invoke('secure_delete_credential', { key });
    } catch (err) {
      console.error('Tauri secure_delete_credential failed:', err);
    }
  }
  localStorage.removeItem(`__sec_${key}`);
}

/**
 * Detect active secure store backend
 */
export async function secureStoreBackend() {
  if (window.__TAURI__?.core?.invoke) {
    try {
      return await window.__TAURI__.core.invoke('secure_store_backend');
    } catch (err) {
      console.error('Tauri secure_store_backend probe failed:', err);
    }
  }
  return 'Web AES-GCM (瀏覽器沙盒)';
}
