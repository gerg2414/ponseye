export default function LoadingLaunch() {
  return (
    <main className="launchPage" aria-busy="true">
      <header className="launchNav">
        <span className="backLink"><span>←</span> All launches</span>
        <div className="detailLive"><i /> Opening live record</div>
      </header>
      <section className="chartEmpty" style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
        Loading launch intelligence…
      </section>
    </main>
  );
}
