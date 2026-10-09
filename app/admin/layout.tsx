import "./admin.css";
import AdminNav from "./AdminNav";
import ResponsiveTableLabels from "./components/ResponsiveTableLabels";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Admin | Thoddoo Marine Excursion",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { id?: string; email?: string | null } | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
    if (user) {
      const { data: profile } = await supabase
        .from("staff_profiles")
        .select("full_name, role")
        .eq("user_id", user.id)
        .single();

      return (
        <div className="adminLayout">
          <ResponsiveTableLabels />
          <AdminNav
            userName={profile?.full_name || user.email || "Staff"}
            userRole={profile?.role || "reception"}
          />
          <main className="adminMain">{children}</main>
        </div>
      );
    }
  } catch {
    // Transient Supabase/auth failure — fall through to a fresh login attempt.
  }
  redirect("/login");
}
