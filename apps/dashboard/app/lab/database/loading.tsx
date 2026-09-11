import Image from "next/image";
import Link from "next/link";

export default function DatabaseLoading() {
  return (
    <main className="databasePage" aria-busy="true">
      <header className="labNav">
        <div className="labBrand">
          <Link href="/" aria-label="PonsEye dashboard">
            <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
          </Link>
          <span>Lab database</span>
        </div>
        <div className="labNavLinks">
          <Link className="backLink" href="/lab">Testing Lab <b>↗</b></Link>
          <Link className="backLink" href="/">Launch dashboard <b>↗</b></Link>
        </div>
      </header>

      <section className="databaseIntro">
        <div>
          <small>All recorded launches</small>
          <h1>Token database</h1>
          <p>Reading collected launch records...</p>
        </div>
      </section>

      <section className="databaseStats databaseSkeletonStats" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <article key={index}><i /><b /></article>)}
      </section>

      <div className="databaseSkeletonFilters" aria-hidden="true"><i /><i /><i /></div>

      <section className="databaseLedger databaseSkeletonLedger">
        <header><div><small>Database rows</small><strong>Loading records</strong></div></header>
        <div aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </div>
      </section>
    </main>
  );
}
