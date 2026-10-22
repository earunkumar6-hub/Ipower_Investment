"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";

const EVERY_MS = 30_000;

/**
 * Keeps the login alive while someone is working: a click, key press or page change renews it (at most every
 * 30 s). No timer, so an untouched page times out. Once the login has expired, the next activity goes to login.
 */
export function SessionKeepAlive() {
  const pathname = usePathname();
  const last = useRef(0);

  useEffect(() => {
    async function ping() {
      if (Date.now() - last.current < EVERY_MS) return;
      last.current = Date.now();
      const { data, error } = await authClient.getSession();
      if (!data && !error) window.location.href = "/login";
    }
    void ping();
    window.addEventListener("click", ping);
    window.addEventListener("keydown", ping);
    return () => {
      window.removeEventListener("click", ping);
      window.removeEventListener("keydown", ping);
    };
  }, [pathname]);

  return null;
}
