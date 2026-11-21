import { portfolioVideos } from './lib/portfolioVideos';
import PortfolioVideoCard from './components/PortfolioVideoCard';
import { PortfolioVideoMuteProvider } from './components/PortfolioVideoMuteContext';

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
            <span className="eyebrow">VIDEO STORIES</span>
            <h2 id="portfolio-video-heading">Moments in motion.</h2>
            <p>{portfolioVideos.length} videos</p>
          </div>
          {portfolioVideos.length ? (
            <ol className="portfolio-video-grid">
              {portfolioVideos.map((video) => <PortfolioVideoCard video={video} key={video.id} />)}
            </ol>
          ) : (
            <p className="language-note">No videos have been added yet.</p>
          )}
        </section>
      </main>
    </PortfolioVideoMuteProvider>
  );
}
