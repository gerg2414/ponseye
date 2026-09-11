import Image from "next/image";
import Link from "next/link";

type LabPage = "testing" | "database";

export function LabHeader({ current }: { current: LabPage }) {
  return (
    <header className="labNav">
      <div className="labBrand">
        <Link href="/" aria-label="PonsEye dashboard">
          <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
        </Link>
      </div>
      <nav className="labNavLinks" aria-label="Lab navigation">
        <Link className={`backLink${current === "testing" ? " active" : ""}`} href="/lab">Testing Lab</Link>
        <Link className={`backLink${current === "database" ? " active" : ""}`} href="/lab/database">Token database</Link>
        <Link className="backLink" href="/">Launch dashboard <b>↗</b></Link>
      </nav>
    </header>
  );
}
