import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { albumInviteUrl } from '@/features/private/services/album-invite';

/**
 * That a shared-album invitation can actually reach the person being invited.
 *
 * The bug: the link was `Linking.createURL(...)`, i.e.
 * `daykeep://private/albums/accept/<token>`. On the sending device that opens
 * correctly, which is the whole problem — the one device it works on is the one
 * holding it. Everywhere it actually has to travel it dies: Gmail sanitises
 * `href` down to http/https/mailto/ftp and renders it as unclickable text,
 * messengers mostly refuse to linkify an unknown scheme, and a phone without
 * Daykeep resolves it to nothing at all.
 *
 * Group invitations already solved this with an https landing page
 * (supabase/functions/join). These assertions are what keep the album's link on
 * that same road, in both halves — the app that builds the URL and the function
 * that answers it.
 */

jest.mock('@/lib/env', () => ({
  env: { EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co' },
  isSupabaseConfigured: true,
}));

// The URL builder is pure, but its module imports the Supabase client, which
// constructs itself at import time and refuses to exist without a key.
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const ROOT = join(__dirname, '..', '..', '..');
const joinFunction = readFileSync(join(ROOT, 'supabase/functions/join/index.ts'), 'utf8');

describe('the link handed to the invitee', () => {
  it('is https, on the project’s own host', () => {
    const url = albumInviteUrl('abc123token');
    expect(url).toBe('https://project-ref.supabase.co/functions/v1/join/album/abc123token');
  });

  /** The failure being guarded against, stated as itself. */
  it('is never a custom scheme', () => {
    expect(albumInviteUrl('abc123token').startsWith('https://')).toBe(true);
    expect(albumInviteUrl('abc123token')).not.toContain('daykeep://');
  });

  /** A trailing slash on the configured URL must not produce `//functions`. */
  it('survives a trailing slash in the configured URL', () => {
    jest.resetModules();
    jest.doMock('@/lib/env', () => ({
      env: { EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co/' },
      isSupabaseConfigured: true,
    }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
    // Re-imported under a different mocked env, which needs a synchronous
    // require: `await import()` needs --experimental-vm-modules, which this
    // project's jest does not run with.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reloaded = require('@/features/private/services/album-invite') as {
      albumInviteUrl: (token: string) => string;
    };
    expect(reloaded.albumInviteUrl('t')).toBe(
      'https://project-ref.supabase.co/functions/v1/join/album/t',
    );
  });

  /** The screen must use it. A correct helper nothing calls fixes nothing. */
  it('is what the invite screen shares', () => {
    const screen = readFileSync(join(ROOT, 'app/private/albums/[id]/invite.tsx'), 'utf8');
    expect(screen).toContain('albumInviteUrl(');
    expect(screen).not.toContain('Linking.createURL');
  });
});

describe('the page that answers it', () => {
  it('tells an album invitation apart from a group one', () => {
    expect(joinFunction).toContain("segments[segments.length - 2] === 'album'");
    expect(joinFunction).toContain('private/albums/accept/');
  });

  /** `/join/album` with no token is a truncated link, not an invitation to the
   *  album whose token is the literal string "album". */
  it('refuses the prefix on its own', () => {
    expect(joinFunction).toContain("token === 'album'");
  });

  /**
   * The link grants membership; it does not carry the key. Saying so on the
   * page is the difference between an invitee who knows to expect a second
   * message and one who reports the album as broken because the photos will
   * not open.
   */
  it('says the link alone cannot open the photos', () => {
    const album = joinFunction.slice(joinFunction.indexOf('album: {'));
    expect(album.slice(0, 600)).toMatch(/end-to-end encrypted/);
  });
});
