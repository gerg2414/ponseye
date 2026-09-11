import { LabHeader } from "./lab-header";

export default function LabLoading() {
  return (
    <main className="labPage">
      <LabHeader current="testing" />
      <section className="labLoadingPanel">
        <span className="emptyEye"><i /></span>
        <strong>Loading the test bench</strong>
      </section>
    </main>
  );
}
