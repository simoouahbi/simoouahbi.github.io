import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { PortfolioVideo } from '../lib/portfolioVideos';
import { usePortfolioVideoMute } from './PortfolioVideoMuteContext';

function ExpandableText({ text, lines }: { text: string; lines: 1 | 2 | 3 }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;

    const measureOverflow = () => {
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    };
    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <span className="expandable-text">
      <span ref={textRef} className={`expandable-text-content ${expanded ? '' : `line-clamp-${lines}`}`}>
        {text}
      </span>
      {canExpand && (
        <button className="expandable-text-toggle" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}

export default function PortfolioVideoCard({ video }: { video: PortfolioVideo }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const { activeVideoId, toggleMute } = usePortfolioVideoMute();
  const videoId = video.src ?? video.title;
  const isMuted = activeVideoId !== videoId;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      element.pause();
    };
  }, []);

  const playVideo = () => {
    const element = videoRef.current;
    if (!element || !element.paused) return;
    void element.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('Unable to play portfolio video on mouse hover.', error);
    });
  };

  const pauseVideo = () => {
    videoRef.current?.pause();
  };

  const togglePlayback = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      playVideo();
    } else {
      element.pause();
    }
  };

  return (
    <li className="portfolio-video-card">
      <div className="portfolio-video-frame" onMouseEnter={playVideo} onMouseLeave={pauseVideo}>
        <video
          ref={videoRef}
          muted={isMuted}
          loop
          playsInline
          preload="metadata"
          aria-label={`${video.title}. ${video.description}`}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        >
          <source src={video.src} type="video/mp4" />
          Your browser does not support embedded video. <a href={video.src}>Open the MP4 video.</a>
        </video>
        <div className="portfolio-video-controls">
          <button type="button" onClick={togglePlayback} aria-label={isPlaying ? `Pause ${video.title}` : `Play ${video.title}`}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            onClick={() => toggleMute(videoId)}
            aria-label={isMuted ? `Unmute ${video.title}` : `Mute ${video.title}`}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
      <div className="portfolio-video-copy">
        <span className="eyebrow">{video.category}</span>
        <h3><ExpandableText text={video.title} lines={1} /></h3>
        <p><ExpandableText text={video.description} lines={2} /></p>
      </div>
    </li>
  );
}
