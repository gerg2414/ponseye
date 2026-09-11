import { LabHeader } from "../lab-header";

export default function DatabaseLoading() {
  return (
    <main className="databasePage" aria-busy="true">
      <LabHeader current="database" />

      <section className="databaseStats databaseSkeletonStats" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <article key={index}><i /><b /></article>)}
      </section>

      <div className="databaseSkeletonFilters" aria-hidden="true"><i /><i /><i /></div>

      <section className="databaseLedger databaseSkeletonLedger" aria-hidden="true">
        <header><div><small>Database rows</small><strong>Loading records</strong></div></header>
        <div>
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </div>
      </section>
    </main>
  );
}
