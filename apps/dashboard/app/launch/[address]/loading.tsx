import { LaunchBackLink } from "./launch-back-link";

export default function LoadingLaunch() {
  return (
    <main className="launchPage positionPage" aria-busy="true">
      <header className="launchNav">
        <LaunchBackLink />
        <div className="positionNavStatus watching"><i /> Opening live record</div>
      </header>
      <section className="chartLoadingSkeleton" aria-hidden="true">
        <div className="chartSkeletonTitle"><i /><b /></div>
        <div className="chartSkeletonPlot"><i /><i /><i /><i /></div>
        <div className="chartSkeletonStats">
          {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
        </div>
      </section>
    </main>
  );
}
