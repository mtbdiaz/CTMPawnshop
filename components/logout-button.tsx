"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
// buttonClasses = the app's standard button style
// cx = joins extra class names onto that style
import { buttonClasses, cx } from "./ui";

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
    // D4: same button as before, plus whitespace-nowrap so "Sign out" never breaks onto 2 lines on phones
    <button type="button" onClick={handleLogout} disabled={pending} className={cx(buttonClasses("secondary", "sm"), "whitespace-nowrap")}>
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}
