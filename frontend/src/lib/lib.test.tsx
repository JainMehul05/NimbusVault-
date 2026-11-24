import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ErrorBoundary } from '@components/ErrorBoundary';
import { startDownload } from '@services/files';
import { passwordProblem } from './password';
import { describeDevice } from './userAgent';

describe('helpers', () => {
  it('mirrors the server password policy', () => {
    expect(passwordProblem('short1')).toMatch(/8 characters/);
    expect(passwordProblem('onlyletters')).toMatch(/number or symbol/);
    expect(passwordProblem('1234567890')).toMatch(/letter/);
    expect(passwordProblem(`é1${'x'.repeat(71)}`)).toMatch(/72/);
    expect(passwordProblem('Passw0rd')).toBeNull();
  });

  it('names devices', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1')).toBe('Safari on iOS');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/140 Safari/537 Edg/140')).toBe('Edge on macOS');
    expect(describeDevice(null)).toBe('Unknown device');
    expect(describeDevice('curl/8')).toBe('API client');
  });

  it('downloads through a transient link that cannot reach back into the page', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('https://s3.example/f');
      expect(this.rel).toContain('noopener');
    });
    startDownload('https://s3.example/f');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[href="https://s3.example/f"]')).toBeNull();
    click.mockRestore();
  });

  it('shows a recovery page instead of a blank screen', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => { throw new Error('boom'); };
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    silence.mockRestore();
  });
});
