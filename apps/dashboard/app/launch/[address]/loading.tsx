import { LaunchBackLink } from "./launch-back-link";

export default function LoadingLaunch() {
  return (
    <main className="launchPage" aria-busy="true">
      <header className="launchNav">
        <LaunchBackLink />
        <div className="detailLive"><i /> Opening live record</div>
      </header>
      <section className="chartEmpty" style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
        Loading launch intelligence…
      </section>
    </main>
  );
}
