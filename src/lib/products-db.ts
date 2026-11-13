import { db } from "@/lib/db";
import { orderGroups, QUOTE_GROUPS } from "@/lib/products";

/** Categories offered on Settings → Products (#12): the starting four plus every category already given to a product. */
export async function productCategories(tenantId: string) {
  const rows = await db.product.findMany({ where: { tenantId, category: { not: null } }, select: { category: true }, distinct: ["category"] });
  return orderGroups([...QUOTE_GROUPS, ...rows.map((r) => r.category!.trim()).filter(Boolean)]);
}
