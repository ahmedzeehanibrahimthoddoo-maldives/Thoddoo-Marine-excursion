import { getPayments } from "@/lib/supabase/actions";
import PaymentPageClient from "./PaymentPageClient";

export const metadata = { title: "Payments | Thoddoo Marine Admin" };

export default async function PaymentsPage() {
  let payments;
  try {
    payments = await getPayments();
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Payments</h1></div>
        <div className="errorState">
          <p>Unable to load payments. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <PaymentPageClient payments={payments} />
    </div>
  );
}
