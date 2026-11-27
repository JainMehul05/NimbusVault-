import { vi } from 'vitest';
import { api } from '@services/api';
import { shareLinkApi } from '@services/shareLinks';
import { activityApi } from '@services/activity';
import { toAiStatus } from '@services/ai';

vi.mock('@services/api');

describe('service contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: {} } } as never);
  });

  it('sends share-link passwords in a header, never in the URL', async () => {
    await shareLinkApi.accessShareLink('tok_123', 's3cret');
    await shareLinkApi.downloadShareLink('tok_123', 's3cret');
    for (const call of vi.mocked(api.get).mock.calls) {
      expect(String(call[0])).not.toContain('s3cret');
      expect(call[1]).toEqual({ headers: { 'X-Share-Password': 's3cret', 'X-Share-Password-Encoding': 'percent' } });
    }
  });

  it('encodes non-ASCII share passwords so they survive HTTP headers', async () => {
    await shareLinkApi.accessShareLink('tok_123', 'пароль');
    const headers = vi.mocked(api.get).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Share-Password']).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(headers['X-Share-Password'])).toBe('пароль');
  });

  it('never sends a userId filter for the activity feed', async () => {
    await activityApi.getActivityLog({ page: 1, limit: 20, action: 'file_upload' });
    const url = String(vi.mocked(api.get).mock.calls[0][0]);
    expect(url).toContain('action=file_upload');
    expect(url).not.toContain('userId');
  });

  it('maps raw AI status values', () => {
    expect(toAiStatus('INDEXED')).toBe('ready');
    expect(toAiStatus('UNSUPPORTED')).toBe('unsupported');
    expect(toAiStatus(undefined)).toBe('not_indexed');
  });
});
