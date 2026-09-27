jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64', HEX: 'hex' },
    getRandomBytes: jest.fn((n: number) => new Uint8Array(nodeCrypto.randomBytes(n))),
    digestStringAsync: jest.fn(async (_alg: string, data: string, options?: { encoding?: string }) =>
      nodeCrypto.createHash('sha256').update(data).digest(options?.encoding === 'base64' ? 'base64' : 'hex')
    ),
  };
});

import { createHash } from 'crypto';
import * as Crypto from 'expo-crypto';
import { base64UrlEncode, createPkcePair } from '../discordPkce';

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;

describe('Discord PKCE (S256)', () => {
  it('verifier = 32 random bytes as base64url (43 chars, no padding)', async () => {
    const { verifier } = await createPkcePair();
    expect(verifier).toMatch(B64URL_43);
    expect(Crypto.getRandomBytes).toHaveBeenCalledWith(32);
  });

  it('challenge = base64url(sha256(verifier)), 43 chars, no padding', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(challenge).toMatch(B64URL_43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(challenge).not.toBe(verifier);
  });

  it('is fresh on every call', async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('base64UrlEncode matches Node for every length/padding case', () => {
    for (let n = 0; n <= 40; n++) {
      const bytes = new Uint8Array(require('crypto').randomBytes(n));
      expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });
});
