import LoginForm from "../LoginForm";

export const metadata = { title: "CMS Login | Thoddoo Marine" };

export default function CmsLoginPage() {
  return (
    <LoginForm
      mode="cms"
      title="CMS"
      subtitle="Content management login for site settings, gallery & pages"
      redirectTo="/admin/content/settings"
    />
  );
}