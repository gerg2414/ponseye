import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Open Token on GMGN | PonsEye Lab",
  description: "Open the complete GMGN page for this migrated PONS token.",
};

export default async function BitqueryMigrationTokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(address)) notFound();
  redirect(`https://gmgn.ai/robinhood/token/${address.toLowerCase()}`);
}
