import { avatarUrl, initialsFor, signedAvatarUrl } from '@/features/profile/services/avatar';

/**
 * Avatar URLs and the initials fallback — the first tests `features/profile`
 * has had.
 *
 * The cache-buster is the part worth pinning. `expo-image` keys its disk cache
 * on the whole URL string, so without `?v=<updatedAt>` a user who changes their
 * picture keeps seeing the old one — on their own profile, indefinitely, with
 * nothing to clear it. And the two URL builders append it differently (`?v=` vs
 * `&v=`) because the signed URL already carries a query string; getting that
 * wrong produces a malformed URL that silently 400s into an empty circle.
 */

const mockGetPublicUrl = jest.fn();
const mockCreateSignedUrl = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      }),
    },
  },
}));

jest.mock('@/lib/env', () => ({ isSupabaseConfigured: true }));
jest.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'uid-1' } }) },
}));
jest.mock('@/lib/media-permissions', () => ({ hasMediaAccess: jest.fn(async () => true) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

describe('avatarUrl', () => {
  it('appends the cache-buster with a question mark', () => {
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://host/o/uid-1/avatar.jpg' } });

    expect(avatarUrl('uid-1/avatar.jpg', 1700000000000)).toBe(
      'https://host/o/uid-1/avatar.jpg?v=1700000000000',
    );
  });

  it('omits the cache-buster when there is no timestamp', () => {
    // A trailing `?v=null` would be a different string from the one cached on
    // the previous render, defeating the cache for no reason.
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://host/o/uid-1/avatar.jpg' } });

    expect(avatarUrl('uid-1/avatar.jpg', null)).toBe('https://host/o/uid-1/avatar.jpg');
  });

  it('is null when there is no stored path', () => {
    // The common case: a profile that has never had a picture. The caller draws
    // initials instead, so this must be null rather than a URL that 404s.
    expect(avatarUrl(null, 1)).toBeNull();
    expect(mockGetPublicUrl).not.toHaveBeenCalled();
  });

  it('is null when the client returns no URL', () => {
    mockGetPublicUrl.mockReturnValue({ data: null });

    expect(avatarUrl('uid-1/avatar.jpg', 1)).toBeNull();
  });
});

describe('signedAvatarUrl', () => {
  it('appends the cache-buster with an ampersand, since the URL already has a query', () => {
    // `?v=` here would produce a second question mark and a URL the storage
    // host rejects — visible only as a picture that never loads.
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://host/o/uid-1/avatar.jpg?token=abc' },
      error: null,
    });

    return expect(signedAvatarUrl('uid-1/avatar.jpg', 42)).resolves.toBe(
      'https://host/o/uid-1/avatar.jpg?token=abc&v=42',
    );
  });

  it('signs for an hour', async () => {
    // Long enough for any visit to the profile screen, short enough that the
    // URL is not a durable credential if it reaches a log.
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://host/x?token=1' },
      error: null,
    });

    await signedAvatarUrl('uid-1/avatar.jpg', null);

    expect(mockCreateSignedUrl).toHaveBeenCalledWith('uid-1/avatar.jpg', 3600);
  });

  it('resolves null rather than throwing when signing fails', async () => {
    // This is already the retry path after the public URL failed. An exception
    // here would take down the profile screen instead of falling back to
    // initials.
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(signedAvatarUrl('uid-1/avatar.jpg', 1)).resolves.toBeNull();

    mockCreateSignedUrl.mockRejectedValue(new Error('offline'));
    await expect(signedAvatarUrl('uid-1/avatar.jpg', 1)).resolves.toBeNull();
  });

  it('does not call out at all without a path', async () => {
    await expect(signedAvatarUrl(null, 1)).resolves.toBeNull();
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });
});

describe('initialsFor', () => {
  it('takes the first and last name', () => {
    expect(initialsFor('Ada Lovelace', null)).toBe('AL');
    expect(initialsFor('Jean Luc Picard', null)).toBe('JP');
  });

  it('takes two letters from a single name', () => {
    expect(initialsFor('Ada', null)).toBe('AD');
  });

  it('falls back to the local part of the email', () => {
    expect(initialsFor(null, 'ada.lovelace@example.com')).toBe('AL');
    expect(initialsFor(null, 'ada@example.com')).toBe('AD');
  });

  it('prefers a real name over the email', () => {
    expect(initialsFor('Ada Lovelace', 'someone.else@example.com')).toBe('AL');
  });

  it('treats a blank name as absent', () => {
    // `name?.trim() || email` — a profile row holding "   " must not produce
    // initials from whitespace.
    expect(initialsFor('   ', 'ada@example.com')).toBe('AD');
  });

  it('splits on dots, underscores and hyphens as well as spaces', () => {
    // Email local parts use all three, and so do some display names.
    expect(initialsFor('ada_lovelace', null)).toBe('AL');
    expect(initialsFor('ada-lovelace', null)).toBe('AL');
    expect(initialsFor('ada.lovelace', null)).toBe('AL');
  });

  it('returns a placeholder rather than an empty circle when it has nothing', () => {
    expect(initialsFor(null, null)).toBe('?');
    expect(initialsFor('', '')).toBe('?');
    expect(initialsFor('...', null)).toBe('?');
  });

  it('uppercases whatever it finds', () => {
    expect(initialsFor('ada lovelace', null)).toBe('AL');
  });

  it('handles a non-Latin name without throwing', () => {
    // Urdu, Arabic and Hindi profiles all reach this. Case mapping is a no-op
    // for these scripts; what matters is that something renders.
    expect(initialsFor('نادر حسین', null)).toBe('نح');
    expect(initialsFor('आदित्य', null)).toBe('आद');
  });
});
