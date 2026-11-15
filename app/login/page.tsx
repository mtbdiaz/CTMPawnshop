import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

// the browser tab says "Sign in · CTM PawnTrack" (the layout adds the name)
export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthCard title="Sign in">
      <LoginForm />
    </AuthCard>
  );
}
