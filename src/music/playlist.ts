export interface PublicTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
}

// Add tracks you have permission to publish. Public entries and their audio files are accessible to every visitor.
export const PUBLIC_PLAYLIST: PublicTrack[] = [];
