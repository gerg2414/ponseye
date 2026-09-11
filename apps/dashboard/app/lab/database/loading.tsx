import { LabHeader } from "../lab-header";
import { RouteLoader } from "../../route-loader";

export default function DatabaseLoading() {
  return (
    <main className="databasePage" aria-busy="true">
      <LabHeader current="database" />
      <RouteLoader label="Loading token database" />
    </main>
  );
}
