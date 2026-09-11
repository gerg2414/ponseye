import type { Metadata } from "next";
import { getPonsEyeLabData } from "../../lib/lab-data";
import { LabHeader } from "./lab-header";
import { PonsEyeLab } from "./ponseye-lab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PonsEye Lab",
  description: "Replay PonsEye signals and test weighted research rules.",
};

export default async function LabPage() {
  const tokens = await getPonsEyeLabData();
  return (
    <main className="labPage">
      <LabHeader current="testing" />

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
