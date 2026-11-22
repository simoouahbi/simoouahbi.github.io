export interface PublicTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
}

// Add tracks you have permission to publish. The footer player appears once this list is non-empty.
export const PUBLIC_PLAYLIST: PublicTrack[] = [
  {
    id: 'marociasong',
    title: 'Marociasong خويي',
    artist: 'ECO Music',
    audioUrl: '/music/marociasong.mp3',
  },
];
