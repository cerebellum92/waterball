// Native Web Crypto API (AES-256-GCM) Local Secret Protection for Waterball

const SEED_STORAGE_KEY = 'bbsterm_crypto_seed_v1';

async function getOrCreateKey() {
  let seed = localStorage.getItem(SEED_STORAGE_KEY);
  if (!seed) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    seed = Array.from(randomBytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('waterball-bbs-local-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function encryptSecret(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return '';
  if (plaintext.startsWith('enc:v1:')) return plaintext;

  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return `enc:v1:${bufferToBase64(iv)}:${bufferToBase64(encrypted)}`;
}

export async function decryptSecret(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return '';
  if (!ciphertext.startsWith('enc:v1:')) return ciphertext;

  const parts = ciphertext.split(':');
  if (parts.length !== 4) return '';

  try {
    const key = await getOrCreateKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(base64ToBuffer(parts[2])) },
      key,
      base64ToBuffer(parts[3])
    );
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return '';
  }
}
