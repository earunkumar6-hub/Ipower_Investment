import { PageHeader } from "@/components/page-header";
import { productCategories } from "@/lib/products-db";
import { requirePermission } from "@/lib/session";
import { ProductForm } from "../../product-forms";
import { SettingsTabs } from "../../settings-tabs";

export default async function NewProductPage() {
  const user = await requirePermission("Settings.Edit");
  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="products" />
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">Add product</h2>
        <ProductForm categories={await productCategories(user.tenantId)} product={{
          name: "", productType: "Insurance", partner: "", category: "", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly"], lockInMonths: null,
          bankDetailsRequired: false, bankFields: [], prematureClosure: true, closeDuringLockIn: false, fields: ["policyNumber", "commencement", "maturity", "nominee"],
          requiredFields: ["policyNumber", "commencement"], active: true,
        }} />
        <p className="mt-3 text-xs text-muted-foreground">Schemes, interest rates and custom fields are added after the product is saved.</p>
      </div>
    </>
  );
}
