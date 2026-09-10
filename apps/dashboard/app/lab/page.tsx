import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getPonsEyeLabData } from "../../lib/lab-data";
import { PonsEyeLab } from "./ponseye-lab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PonsEye Lab",
  description: "Replay PonsEye signals and test weighted research rules.",
};

export default async function LabPage() {
  const tokens = await getPonsEyeLabData();
  const completeJourneys = tokens.filter((token) => token.outcome_scope === "full_market").length;

  return (
    <main className="labPage">
      <header className="labNav">
        <Link href="/" aria-label="PonsEye dashboard">
          <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
        </Link>
        <div className="labNavLinks">
          <span><i /> Recorded evidence</span>
          <Link className="backLink" href="/">Launch dashboard <b>↗</b></Link>
        </div>
      </header>

      <section className="labHero">
        <div>
          <p className="eyebrow"><span>04</span> Research simulator</p>
          <h1>PonsEye <em>Lab.</em></h1>
          <p>Change the signal. Replay the evidence.</p>
        </div>
        <div className="labDatasetReadout">
          <small>Dataset loaded</small>
          <strong>{tokens.length.toLocaleString("en-GB")}</strong>
          <span>{completeJourneys} full journeys · {tokens.length - completeJourneys} curve only</span>
        </div>
      </section>

      {tokens.length ? (
        <PonsEyeLab tokens={tokens} />
      ) : (
        <section className="labEmpty">
          <span className="emptyEye"><i /></span>
          <h2>Lab data unavailable</h2>
          <p>The recorded evidence could not be loaded. Try refreshing the page.</p>
        </section>
      )}
    </main>
  );
}
