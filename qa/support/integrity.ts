import type { PrismaClient } from "@prisma/client";

/** Rows pointing at a parent that does not exist (FK columns without a DB constraint included). */
export const ORPHAN_CHECKS: [string, string][] = [
  ["Policy → Customer", `select count(*)::int n from "Policy" p left join "Customer" c on c.id = p."customerId" where c.id is null`],
  ["RenewalItem → Policy", `select count(*)::int n from "RenewalItem" r left join "Policy" p on p.id = r."policyId" where p.id is null`],
  ["Receipt → Customer", `select count(*)::int n from "Receipt" r left join "Customer" c on c.id = r."customerId" where r."customerId" is not null and c.id is null`],
  ["Receipt → Payment", `select count(*)::int n from "Receipt" r left join "Payment" p on p.id = r."paymentId" where r."paymentId" is not null and p.id is null`],
  ["RenewalItem paid → Receipt", `select count(*)::int n from "RenewalItem" r left join "Receipt" x on x.id = r."paidReceiptId" where r."paidReceiptId" is not null and x.id is null`],
  ["QuotationItem → Quotation", `select count(*)::int n from "QuotationItem" i left join "Quotation" q on q.id = i."quotationId" where q.id is null`],
  ["Proposal → Quotation", `select count(*)::int n from "Proposal" p left join "Quotation" q on q.id = p."quotationId" where p."quotationId" is not null and q.id is null`],
  ["Call → Lead", `select count(*)::int n from "Call" c left join "Lead" l on l.id = c."leadId" where c."leadId" is not null and l.id is null`],
  ["Customer.ownerId → User", `select count(*)::int n from "Customer" c left join "User" u on u.id = c."ownerId" where u.id is null`],
  ["Lead.ownerId → User", `select count(*)::int n from "Lead" l left join "User" u on u.id = l."ownerId" where u.id is null`],
  ["Receipt.createdById → User", `select count(*)::int n from "Receipt" r left join "User" u on u.id = r."createdById" where u.id is null`],
  ["Ticket.raisedById → User", `select count(*)::int n from "Ticket" t left join "User" u on u.id = t."raisedById" where u.id is null`],
  ["DayBookEntry → Account", `select count(*)::int n from "DayBookEntry" d left join "Account" a on a.id = d."accountId" where a.id is null`],
];

export async function orphanCounts(db: PrismaClient) {
  const out: Record<string, number> = {};
  for (const [name, sql] of ORPHAN_CHECKS) out[name] = (await db.$queryRawUnsafe<{ n: number }[]>(sql))[0].n;
  return out;
}

/** Foreign keys that must exist as DB constraints: [table, column]. */
export const REQUIRED_FKS: [string, string][] = [
  ["Policy", "customerId"], ["RenewalItem", "policyId"], ["Receipt", "customerId"], ["Receipt", "paymentId"], ["QuotationItem", "quotationId"],
  ["Proposal", "quotationId"], ["Call", "leadId"], ["CustomerMobile", "customerId"], ["TicketComment", "ticketId"], ["DayBookEntry", "accountId"],
];
/** User references that the app relies on but the DB may not enforce. */
export const USER_REFS: [string, string][] = [
  ["Customer", "ownerId"], ["Lead", "ownerId"], ["Policy", "ownerId"], ["Receipt", "createdById"], ["Ticket", "raisedById"], ["AuditLog", "userId"], ["Expense", "createdById"],
];

export async function fkColumns(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `select kcu.table_name, kcu.column_name from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`);
  return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
}

/** Duplicate business numbers per tenant. */
export const NUMBER_COLUMNS: [string, string][] = [
  ["Receipt", "receiptNo"], ["Payment", "paymentNo"], ["RenewalItem", "billNo"], ["Lead", "leadNo"], ["Quotation", "quoteNo"], ["Proposal", "proposalNo"], ["Ticket", "ticketNo"], ["Expense", "expenseNo"],
];
export async function duplicateNumbers(db: PrismaClient) {
  const out: Record<string, number> = {};
  for (const [t, c] of NUMBER_COLUMNS) {
    out[`${t}.${c}`] = (await db.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int n from (select "tenantId", "${c}" from "${t}" where "${c}" is not null group by 1, 2 having count(*) > 1) d`))[0].n;
  }
  return out;
}

/** Every column that holds a user id (owner / created by / decided by / …) but has no foreign key to "User". Attachment.ownerId is the record it belongs to, not a user. */
export async function userColumnsWithoutFk(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<{ ref: string }[]>(
    `select c.table_name || '.' || c.column_name as ref
       from information_schema.columns c
      where c.table_schema = 'public' and c.table_name not in ('User', 'Session', 'AuthAccount', 'Verification', '_prisma_migrations', 'Attachment')
        and (c.column_name ~ 'ById$' or c.column_name in ('userId', 'ownerId'))
        and not exists (select 1 from information_schema.key_column_usage k join information_schema.table_constraints t
                          on t.constraint_name = k.constraint_name and t.table_schema = k.table_schema
                         where t.constraint_type = 'FOREIGN KEY' and k.table_name = c.table_name and k.column_name = c.column_name)
      order by 1`);
  return rows.map((r) => r.ref);
}
