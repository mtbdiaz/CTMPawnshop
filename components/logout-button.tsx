"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./icons";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-navy-100 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
    >
      <Icon name="logout" className="h-4 w-4" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
