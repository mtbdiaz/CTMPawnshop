"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SESSION_TIMEOUT_MS, ACTIVITY_EVENTS } from "@/lib/auth/session-timeout";

// PB-5: signs the user out after a period of inactivity.
export function SessionTimeoutWatcher() {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function reset() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(async () => {
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }, SESSION_TIMEOUT_MS);
    }

    reset();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [router]);

  return null;
}
