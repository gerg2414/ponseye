import type { Metadata } from "next";
import Link from "next/link";
import { getTokenDatabase, type DatabaseSort } from "../../../lib/database";
import { TokenImage } from "../../token-image";
import { LabHeader } from "../lab-header";
import { DatabaseCopyAddress } from "./database-copy-address";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Token Database | PonsEye Lab",
  description: "Search every Robinhood Chain token recorded by PonsEye.",
};

const pageSize = 100;
const sorts: Array<{ value: DatabaseSort; label: string }> = [
  { value: "newest", label: "Newest collected" },
  { value: "peak", label: "Highest peak MC" },
  { value: "current", label: "Highest current MC" },
  { value: "multiple", label: "Highest peak multiple" },
  { value: "trades", label: "Most trades" },
  { value: "volume", label: "Highest volume" },
];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function money(value: number | null) {
  if (value == null || value <= 0) return "Pending";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 100_000 ? 1 : 2,
  }).format(value);
}

function launched(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(new Date(value));
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function statusLabel(status: string, graduatedAt: string | null) {
  if (graduatedAt) return "Graduated";
  if (status === "bonding") return "Bonding";
  return status.replaceAll("_", " ");
}

export default async function DatabasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const search = (first(query.q) ?? "").trim();
  const requestedSort = first(query.sort) ?? "newest";
  const sort = sorts.some((option) => option.value === requestedSort)
    ? requestedSort as DatabaseSort
    : "newest";
  const requestedPage = Number(first(query.page) ?? 1);
  const currentPage = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const { tokens, filteredCount, stats } = await getTokenDatabase({
    page: currentPage,
    pageSize,
    search,
    sort,
  });
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const pageQuery = (page: number) => ({
    ...(search ? { q: search } : {}),
    ...(sort !== "newest" ? { sort } : {}),
    page: String(page),
  });

  return (
    <main className="databasePage">
      <LabHeader current="database" />

      <section className="databaseIntro">
        <div>
          <small>All recorded launches</small>
          <h1>Token database</h1>
          <p>Every token collected by PonsEye, including launches that never received a signal.</p>
        </div>
        <strong>{stats.total.toLocaleString("en-GB")}<span>tokens stored</span></strong>
      </section>

      <section className="databaseStats">
        <article><small>Collected</small><strong>{stats.total.toLocaleString("en-GB")}</strong></article>
        <article><small>USD priced</small><strong>{stats.priced.toLocaleString("en-GB")}</strong></article>
        <article><small>Peaked above $100k</small><strong>{stats.over100k.toLocaleString("en-GB")}</strong></article>
        <article><small>Highest peak</small><strong>{money(stats.highestPeak)}</strong></article>
      </section>

      <form className="databaseFilters" action="/lab/database">
        <label><span>Search</span><input name="q" defaultValue={search} placeholder="Name, ticker or contract address" /></label>
        <label>
          <span>Sort by</span>
          <select name="sort" defaultValue={sort}>
            {sorts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="submit">Apply</button>
        {search || sort !== "newest" ? <Link href="/lab/database">Clear</Link> : null}
      </form>

      <section className="databaseLedger">
        <header>
          <div><small>Database rows</small><strong>{filteredCount.toLocaleString("en-GB")} results</strong></div>
          <span>Page {Math.min(currentPage, totalPages)} of {totalPages}</span>
        </header>
        <div className="databaseTableWrap">
          <table>
            <thead>
              <tr><th>Token</th><th>Collected</th><th>Status</th><th>Current MC</th><th>Peak MC</th><th>Peak</th><th>Trades</th><th>Volume</th><th>Links</th></tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.token_address}>
                  <td>
                    <Link className="databaseToken" href={`/launch/${token.token_address}`}>
                      <TokenImage src={token.image_url} alt="" size={36} />
                      <span><strong>{token.name ?? "Metadata pending"}</strong><small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : shortAddress(token.token_address)}</small></span>
                    </Link>
                  </td>
                  <td><time dateTime={token.launched_at}>{launched(token.launched_at)}</time></td>
                  <td><span className={`databaseStatus ${token.graduated_at ? "graduated" : ""}`}>{statusLabel(token.status, token.graduated_at)}</span></td>
                  <td><strong>{money(token.market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{money(token.ath_market_cap_usd)}</strong></td>
                  <td>{token.peak_multiple ? `${token.peak_multiple.toFixed(2)}x` : "Pending"}</td>
                  <td><span>{token.trade_count.toLocaleString("en-GB")}</span><small>{token.buys} buys · {token.sells} sells</small></td>
                  <td>{money(token.volume_usd)}</td>
                  <td><div className="databaseActions"><DatabaseCopyAddress address={token.token_address} /><Link href={`/launch/${token.token_address}`}>Chart</Link><a href={`https://gmgn.ai/robinhood/token/${token.token_address}`} target="_blank" rel="noreferrer">GMGN</a></div></td>
                </tr>
              ))}
              {!tokens.length ? <tr><td className="databaseEmpty" colSpan={9}>No tokens match that search.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className="databasePagination">
          {currentPage > 1 ? <Link href={{ pathname: "/lab/database", query: pageQuery(currentPage - 1) }}>Previous</Link> : <span />}
          <small>{filteredCount ? ((currentPage - 1) * pageSize + 1).toLocaleString("en-GB") : "0"} to {Math.min(currentPage * pageSize, filteredCount).toLocaleString("en-GB")} of {filteredCount.toLocaleString("en-GB")}</small>
          {currentPage < totalPages ? <Link href={{ pathname: "/lab/database", query: pageQuery(currentPage + 1) }}>Next</Link> : <span />}
        </footer>
      </section>
    </main>
  );
}
