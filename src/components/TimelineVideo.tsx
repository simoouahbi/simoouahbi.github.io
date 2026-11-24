import { portfolioVideos } from '../lib/portfolioVideos';
import PortfolioVideoCard from './PortfolioVideoCard';
import { PortfolioVideoMuteProvider } from './PortfolioVideoMuteContext';
import MediaPlaceholderGallery from './MediaPlaceholderGallery';

const featuredVideos = portfolioVideos.slice(0, 3);
const hasFeaturedVideos = featuredVideos.length > 0;

export default function TimelineVideo() {
  return (
    <PortfolioVideoMuteProvider>
      <section className="content-section timeline-video-section" aria-labelledby="timeline-video-heading">
        <div className="section-heading">
          <span className="eyebrow">{hasFeaturedVideos ? 'FEATURED VIDEO STORIES' : 'MEDIA PLACEHOLDERS'}</span>
          <h2 id="timeline-video-heading">{hasFeaturedVideos ? 'Moments in motion.' : 'Make room for future media.'}</h2>
          <p>{hasFeaturedVideos ? 'Video stories' : 'Photo, video, and media spaces are ready for future content.'}</p>
        </div>
        {hasFeaturedVideos ? (
          <ol className="portfolio-video-grid homepage-video-grid">
            {featuredVideos.map((video) => <PortfolioVideoCard video={video} key={video.id} />)}
          </ol>
        ) : (
          <MediaPlaceholderGallery />
        )}
        <a className="secondary-button timeline-all-videos" href="/timeline.html">
          Open the timeline
        </a>
      </section>
    </PortfolioVideoMuteProvider>
  );
}
