import { Card, PageHeader } from "../../ui/primitives";

export default function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Company and contact details come from Monday.com, which stays the master record."
      />

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Not connected yet
          </span>
          <h2 className="text-lg font-bold text-slate-900">No customer data is loaded</h2>
        </div>

        <p className="mt-3 max-w-2xl text-slate-600">
          The connection to Monday.com has not been switched on. No customer names, email addresses,
          or company records have been copied into this system.
        </p>

        <div className="mt-6 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <h3 className="text-sm font-bold text-sky-900">How it will work</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-sky-900">
            <li>• Monday.com stays the place where customer details are edited</li>
            <li>• This system will keep a read-only copy for choosing who receives a newsletter</li>
            <li>• Nothing is ever written back to Monday.com</li>
            <li>• People who unsubscribe stay unsubscribed, even after an update from Monday.com</li>
          </ul>
        </div>

        <p className="mt-6 text-sm text-slate-500">
          Until this is connected, newsletters have no recipients and no email can reach a customer.
        </p>
      </Card>
    </>
  );
}
