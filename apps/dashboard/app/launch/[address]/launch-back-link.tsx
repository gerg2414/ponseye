"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

export function LaunchBackLink() {
  const router = useRouter();

  function returnToPreviousPage(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <Link href="/" className="backLink" onClick={returnToPreviousPage}>
      <span>←</span> Back to previous page
    </Link>
  );
}
