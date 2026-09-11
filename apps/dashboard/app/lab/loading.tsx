import { LabHeader } from "./lab-header";
import { RouteLoader } from "../route-loader";

export default function LabLoading() {
  return (
    <main className="labPage" aria-busy="true">
      <LabHeader current="testing" />
      <RouteLoader label="Loading the test bench" />
    </main>
  );
}
