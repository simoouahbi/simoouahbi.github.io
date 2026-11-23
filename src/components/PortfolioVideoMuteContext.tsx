import { createContext, useContext, useState, type PropsWithChildren } from 'react';

type PortfolioVideoMuteContextValue = {
  activeVideoId: string | null;
  toggleMute: (videoId: string) => void;
};

const PortfolioVideoMuteContext = createContext<PortfolioVideoMuteContextValue | null>(null);

export function PortfolioVideoMuteProvider({ children }: PropsWithChildren) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const toggleMute = (videoId: string) => {
    setActiveVideoId((current) => current === videoId ? null : videoId);
  };

  return (
    <PortfolioVideoMuteContext.Provider value={{ activeVideoId, toggleMute }}>
      {children}
    </PortfolioVideoMuteContext.Provider>
  );
}

export function usePortfolioVideoMute() {
  const context = useContext(PortfolioVideoMuteContext);
  if (!context) throw new Error('Portfolio video mute controls need a PortfolioVideoMuteProvider.');
  return context;
}
