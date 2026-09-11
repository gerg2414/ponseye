import { LabHeader } from "./lab-header";

export default function LabLoading() {
  return (
    <main className="labPage" aria-busy="true">
      <LabHeader current="testing" />
      <section className="labLoadingSkeleton" aria-hidden="true">
        <div className="labSkeletonModels"><i /><b /><i /></div>
        <div className="labSkeletonStats">
          {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
        </div>
        <div className="labSkeletonRows">
          {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
        </div>
      </section>
    </main>
  );
}
