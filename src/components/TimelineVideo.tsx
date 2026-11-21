import { portfolioVideos } from '../lib/portfolioVideos';
import PortfolioVideoCard from './PortfolioVideoCard';
import { PortfolioVideoMuteProvider } from './PortfolioVideoMuteContext';

const featuredVideos = portfolioVideos.slice(0, 3);

export default function TimelineVideo() {
  return (
    <PortfolioVideoMuteProvider>
      <section className="content-section timeline-video-section" aria-labelledby="timeline-video-heading">
        <div className="section-heading">
          <span className="eyebrow">FEATURED VIDEO STORIES</span>
          <h2 id="timeline-video-heading">Moments in motion.</h2>
          <p>Video stories</p>
        </div>
        {featuredVideos.length ? (
          <ol className="portfolio-video-grid homepage-video-grid">
            {featuredVideos.map((video) => <PortfolioVideoCard video={video} key={video.id} />)}
          </ol>
        ) : (
          <p className="language-note">No videos have been added yet.</p>
        )}
        <a className="secondary-button timeline-all-videos" href="/timeline.html">
          Open the timeline
        </a>
      </section>
    </PortfolioVideoMuteProvider>
  );
}
