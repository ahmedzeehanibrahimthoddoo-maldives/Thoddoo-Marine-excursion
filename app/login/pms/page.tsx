import LoginForm from "../LoginForm";

export const metadata = { title: "PMS Login | Thoddoo Marine" };

export default function PmsLoginPage() {
  return (
    <LoginForm
      mode="pms"
      title="PMS"
      subtitle="Reservations, payments & operations staff login"
      redirectTo="/admin"
    />
  );
}