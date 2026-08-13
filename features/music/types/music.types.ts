export type Song = {
  id: string;
  title: string;
  artist: string | null;
  uri: string;
  durationMs: number | null;
  addedAt: number;
  isFavorite: boolean;
  playCount: number;
  lastPlayedAt: number | null;
};

export type Playlist = {
  id: string;
  name: string;
  colorToken: string | null;
  position: number;
  songCount: number;
};

export type RepeatMode = 'off' | 'one' | 'all';
