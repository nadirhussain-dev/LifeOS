import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatVoiceDuration, voiceObjectPath } from '@/features/private/services/voice-notes';

/**
 * The `voice/` path segment is a contract between two files that cannot see
 * each other.
 *
 * `voiceObjectPath` decides where a recording is stored; migration 0054's
 * `enforce_album_media_premium` decides whether an object is free by reading
 * segment 2 of that same path. Nothing in tsc, eslint or the SQL suite
 * connects them — a rename here silently puts every voice note back behind the
 * paid-plan gate, and the only symptom is free users being told to upgrade to
 * send one.
 *
 * So the convention is asserted from both ends here.
 */

const migration = () =>
  readFileSync(join(process.cwd(), 'supabase/migrations/0054_album_chat_live.sql'), 'utf8');

describe('voiceObjectPath', () => {
  it('puts the recording under the album, in voice/', () => {
    expect(voiceObjectPath('alb-1', 'msg-1')).toBe('alb-1/voice/msg-1.bin');
  });

  it('keeps voice as path segment 2', () => {
    // Segment 1 is the album id, which is what the storage isolation policy
    // (0028) keys off. Moving `voice` to segment 1 would break both.
    expect(voiceObjectPath('alb-1', 'msg-1').split('/')[1]).toBe('voice');
  });
});

describe('the migration agrees', () => {
  it('reads the same segment this file writes', () => {
    expect(migration()).toContain("split_part(new.name, '/', 2) = 'voice'");
  });

  it('still caps a voice object, so the carve-out is not free storage', () => {
    const sql = migration();
    expect(sql).toContain('enforce_voice_object_size');
    expect(sql).toContain('16 * 1024 * 1024');
  });

  it('leaves non-voice objects behind the paid gate', () => {
    expect(migration()).toContain('adding photos to a shared album requires a paid plan');
  });
});

describe('formatVoiceDuration', () => {
  it('pads seconds', () => {
    expect(formatVoiceDuration(5000)).toBe('0:05');
  });

  it('rolls over into minutes', () => {
    expect(formatVoiceDuration(65_000)).toBe('1:05');
  });

  it('renders a missing duration as zero rather than NaN', () => {
    // `voice_duration_ms` is null on any row written before 0054.
    expect(formatVoiceDuration(null)).toBe('0:00');
  });

  it('never goes negative', () => {
    expect(formatVoiceDuration(-1)).toBe('0:00');
  });
});
