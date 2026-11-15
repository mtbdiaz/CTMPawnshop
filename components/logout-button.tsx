"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./icons";
// buttonClasses = the app's standard button style
// cx = joins extra class names onto that style
import { buttonClasses, cx } from "./ui";

/** variant "sidebar" = the plain light-on-navy link used in the side menu; `rail` = icon only (collapsed menu). */
export function LogoutButton({ variant = "default", rail = false }: { variant?: "default" | "sidebar"; rail?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={pending}
        aria-label={rail ? "Sign out" : undefined}
        title={rail ? "Sign out" : undefined}
        className="group flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-navy-200 transition-colors hover:bg-red-500/15 hover:text-red-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-400 disabled:opacity-60 motion-reduce:transition-none"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <Icon name="logout" className="h-4 w-4 text-navy-300 group-hover:text-red-200" />
        </span>
        <span className={cx("transition-opacity duration-200 motion-reduce:transition-none", rail && "opacity-0")}>{pending ? "Signing out" : "Sign out"}</span>
      </button>
    );
  }

  return (
    // D4: same button as before, plus whitespace-nowrap so "Sign out" never breaks onto 2 lines on phones
    <button type="button" onClick={handleLogout} disabled={pending} className={cx(buttonClasses("secondary", "sm"), "whitespace-nowrap")}>
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}
