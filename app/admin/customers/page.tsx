import { getCustomers } from "@/lib/supabase/actions";
import CustomerPageClient from "./CustomerPageClient";

export const metadata = { title: "Customers | Thoddoo Marine Admin" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const search = params.q || "";

  let customers;
  try {
    customers = await getCustomers(search);
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Customers</h1></div>
        <div className="errorState">
          <p>Unable to load customers. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Customers</h1>
        <p className="adminPageSub">{customers.length} customers</p>
      </div>

      <form className="searchBar" method="get">
        <input
          type="text"
          name="q"
          placeholder="Search by name, phone or hotel..."
          defaultValue={search}
        />
        <button type="submit">Search</button>
      </form>

      <CustomerPageClient initialCustomers={customers} />
    </div>
  );
}
