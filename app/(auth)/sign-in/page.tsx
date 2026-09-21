import { AuthCard } from "@/features/auth/auth-card";

export const metadata = { title: "Sign in · CampusNav" };

export default function Page() {
  return <AuthCard mode="sign-in" />;
}
