import { intelligence } from '../src/common/intelligence';
import { config } from '../src/config';
import { readRefreshCookie } from '../src/modules/auth/auth.cookies';
import type { Request } from 'express';

it('never sends the private service token to an arbitrary configured host', async () => {
  const oldUrl = process.env.INTELLIGENCE_URL;
  const oldToken = process.env.INTERNAL_SERVICE_TOKEN;
  process.env.INTELLIGENCE_URL = 'https://untrusted.example';
  process.env.INTERNAL_SERVICE_TOKEN = 'synthetic-private-service-token-32-chars';
  const fetch = jest.spyOn(globalThis, 'fetch');
  try {
    await expect(intelligence('/health')).rejects.toThrow('Untrusted intelligence service address');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
    if (oldUrl === undefined) delete process.env.INTELLIGENCE_URL;
    else process.env.INTELLIGENCE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = oldToken;
  }
});

it('keeps the EC2 refresh cookie separate from the Windows cookie on another port', () => {
  const original = config.session.cookieName;
  const family = '11111111-1111-4111-8111-111111111111';
  config.session.cookieName = 'nimbusvault_ec2_refresh';
  try {
    const request = {cookies: {refreshToken: family + '.windows', nimbusvault_ec2_refresh: family + '.cloud'}} as unknown as Request;
    expect(readRefreshCookie(request)).toEqual({tokenFamily: family, refreshToken: 'cloud'});
    expect(readRefreshCookie({cookies: {refreshToken: family + '.windows'}} as unknown as Request)).toBeNull();
  } finally {
    config.session.cookieName = original;
  }
});
