import { LaunchBackLink } from "./launch-back-link";
import { RouteLoader } from "../../route-loader";

export default function LoadingLaunch() {
  return (
    <main className="launchPage positionPage" aria-busy="true">
      <header className="launchNav">
        <LaunchBackLink />
        <div className="positionNavStatus watching"><i /> Opening live record</div>
      </header>
      <RouteLoader label="Loading chart data" />
    </main>
  );
}
