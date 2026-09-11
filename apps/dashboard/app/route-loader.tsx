import Image from "next/image";

export function RouteLoader({ label }: { label: string }) {
  return (
    <section className="routeLoader" aria-live="polite">
      <Image
        className="routeLoaderCharacter"
        src="/ponseye-robot-scanning.gif"
        alt=""
        width={512}
        height={512}
        priority
        unoptimized
      />
      <strong>{label}</strong>
    </section>
  );
}
