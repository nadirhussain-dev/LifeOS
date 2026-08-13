import { and, eq, inArray, isNull } from 'drizzle-orm';
import { File } from 'expo-file-system';

import { getDb } from '@/database/client';
import { playlistSongs, songs } from '@/database/schema';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type { Song } from '@/features/music/types/music.types';

function toSong(row: typeof songs.$inferSelect): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    uri: row.uri,
    durationMs: row.durationMs,
    addedAt: row.addedAt,
    isFavorite: row.isFavorite,
    playCount: row.playCount,
    lastPlayedAt: row.lastPlayedAt,
  };
}

export function listSongs(): Song[] {
  return getDb()
    .select()
    .from(songs)
    .where(and(eq(songs.userId, LOCAL_USER_ID), isNull(songs.deletedAt)))
    .orderBy(songs.addedAt)
    .all()
    .map(toSong);
}

export function getSong(id: string): Song | null {
  const row = getDb().select().from(songs).where(eq(songs.id, id)).get();
  return row ? toSong(row) : null;
}

export function getSongsByIds(ids: string[]): Song[] {
  if (ids.length === 0) return [];
  const rows = getDb().select().from(songs).where(inArray(songs.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, toSong(row)]));
  return ids.map((id) => byId.get(id)).filter((song): song is Song => song != null);
}

/** Inserts an already-imported song row — the file copy + duration probe
 * happen in song-import.ts, which calls this once both are done. */
export function createSong(input: {
  title: string;
  artist: string | null;
  uri: string;
  durationMs: number | null;
}): Song {
  const now = Date.now();
  const song: Song = {
    id: generateId(),
    title: input.title,
    artist: input.artist,
    uri: input.uri,
    durationMs: input.durationMs,
    addedAt: now,
    isFavorite: false,
    playCount: 0,
    lastPlayedAt: null,
  };
  getDb()
    .insert(songs)
    .values({
      ...song,
      userId: LOCAL_USER_ID,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    })
    .run();
  return song;
}

export function updateSong(id: string, input: { title?: string; artist?: string | null }) {
  getDb()
    .update(songs)
    .set({ ...input, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(songs.id, id))
    .run();
}

export function toggleSongFavorite(id: string, isFavorite: boolean) {
  getDb()
    .update(songs)
    .set({ isFavorite, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(songs.id, id))
    .run();
}

/** Called once a track actually starts playing (see `loadIndex` in
 * player-controller.ts) — bumps the counter the library's "Most played" tab
 * and the song-detail screen both read. Best-effort: a play that fails to
 * record is not worth surfacing as an error to someone trying to listen to
 * music, so callers fire this without awaiting or catching. */
export function recordSongPlayed(id: string) {
  const row = getDb()
    .select({ playCount: songs.playCount })
    .from(songs)
    .where(eq(songs.id, id))
    .get();
  if (!row) return;
  getDb()
    .update(songs)
    .set({
      playCount: row.playCount + 1,
      lastPlayedAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: 'pending',
    })
    .where(eq(songs.id, id))
    .run();
}

/** Removes the song everywhere (library, every playlist) and frees the disk
 * space its imported copy used — unlike tasks/notes, there's no "trash" UI
 * to restore a multi-megabyte audio file from, so this deletes the file
 * immediately rather than only soft-deleting the metadata row. */
export function deleteSong(id: string) {
  const song = getSong(id);
  const db = getDb();
  const now = Date.now();
  db.update(playlistSongs)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(playlistSongs.songId, id), isNull(playlistSongs.deletedAt)))
    .run();
  db.update(songs)
    .set({ deletedAt: now, updatedAt: now, syncStatus: 'pending' })
    .where(eq(songs.id, id))
    .run();

  // A row that arrived by sync has no bytes on this device, and `uri` is the
  // empty string rather than a path. Constructing a File from it would throw.
  if (song && song.uri) {
    const file = new File(song.uri);
    if (file.exists) file.delete();
  }
}
