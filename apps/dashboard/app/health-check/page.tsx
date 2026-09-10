export const dynamic = "force-dynamic";

export default function HealthCheckPage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  let hostname = "missing";

  if (url) {
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = "invalid";
    }
  }

  return (
    <pre>{JSON.stringify({ urlPresent: Boolean(url), keyPresent: Boolean(key), hostname }, null, 2)}</pre>
  );
}
