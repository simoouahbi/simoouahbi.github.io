import { portfolioVideos } from './lib/portfolioVideos';
import PortfolioVideoCard from './components/PortfolioVideoCard';
import { PortfolioVideoMuteProvider } from './components/PortfolioVideoMuteContext';
import MediaPlaceholderGallery from './components/MediaPlaceholderGallery';

export default function TimelinePage() {
  return (
    <PortfolioVideoMuteProvider>
      <main id="main" className="page-main timeline-page" tabIndex={-1}>
        <section className="timeline-hero">
          <span className="eyebrow">SIMOOUAHBI’S PORTFOLIO</span>
          <h1>Creative <span className="gradient-text">timeline</span></h1>
          <p>Brand stories, client collaborations, events, and everyday moments—collected in video.</p>
        </section>

        <section className="content-section portfolio-video-timeline" aria-labelledby="portfolio-video-heading">
          <div className="section-heading">
            <span className="eyebrow">{portfolioVideos.length ? 'VIDEO STORIES' : 'MEDIA PLACEHOLDERS'}</span>
            <h2 id="portfolio-video-heading">{portfolioVideos.length ? 'Moments in motion.' : 'Make room for future media.'}</h2>
            <p>{portfolioVideos.length ? `${portfolioVideos.length} videos` : 'Photo, video, and media spaces are ready for future content.'}</p>
          </div>
          {portfolioVideos.length ? (
            <ol className="portfolio-video-grid">
              {portfolioVideos.map((video) => <PortfolioVideoCard video={video} key={video.id} />)}
            </ol>
          ) : (
            <MediaPlaceholderGallery />
          )}
        </section>
      </main>
    </PortfolioVideoMuteProvider>
  );
}
