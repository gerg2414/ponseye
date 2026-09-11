import { LabHeader } from "./lab-header";

export default function LabLoading() {
  return (
    <main className="labPage">
      <LabHeader current="testing" />
      <section className="labHero">
        <div>
          <p className="eyebrow"><span>04</span> Research simulator</p>
          <h1>PonsEye <em>Lab.</em></h1>
          <p>Loading recorded evidence...</p>
        </div>
      </section>
      <section className="labLoadingPanel">
        <span className="emptyEye"><i /></span>
        <strong>Replaying Surveillance checkpoints</strong>
      </section>
    </main>
  );
}
