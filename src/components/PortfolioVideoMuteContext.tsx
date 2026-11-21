import { createContext, useContext, useState, type PropsWithChildren } from 'react';

type PortfolioVideoMuteContextValue = {
  isMuted: boolean;
  toggleMute: () => void;
};

const PortfolioVideoMuteContext = createContext<PortfolioVideoMuteContextValue | null>(null);

export function PortfolioVideoMuteProvider({ children }: PropsWithChildren) {
  const [isMuted, setIsMuted] = useState(true);
  const toggleMute = () => setIsMuted((current) => !current);

  return (
    <PortfolioVideoMuteContext.Provider value={{ isMuted, toggleMute }}>
      {children}
    </PortfolioVideoMuteContext.Provider>
  );
}

export function usePortfolioVideoMute() {
  const context = useContext(PortfolioVideoMuteContext);
  if (!context) throw new Error('Portfolio video mute controls need a PortfolioVideoMuteProvider.');
  return context;
}
