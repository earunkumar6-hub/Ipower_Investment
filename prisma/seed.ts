// Demo seed: ABC Financial Services on the current IST date; earlier days closed and verified.
// Everything that moves money is posted through the same Day Book library the app uses.
import type { Frequency, PaymentMode, Policy, ProductType, Role } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { accountDay, post } from "@/lib/daybook";
import { addDays, financialYear, isoDate, istToday } from "@/lib/dates";
import { db, prisma, type Tx } from "@/lib/db";
import { poCommission } from "@/lib/commission";
import { D, ZERO } from "@/lib/money";
import { postExpensePayment, postPoDeposit, postReceipt, postServiceTransaction } from "@/lib/posting";
import { linkPolicies, seedProducts } from "./seed-products";
import { defaultPayOptions } from "@/lib/payment-options";
import { DEFAULT_DROPDOWN_VALUES } from "@/lib/dropdowns";

const PASSWORD = "demo1234";
const today = istToday();
const yesterday = addDays(today, -1);
const now = new Date();
const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
const fy = financialYear(today);

// Deterministic pseudo-random numbers so every reseed gives the same data.
let seed = 20261011;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

// Target opening balances for today (fl_crm_demo.json → seed_data.accounts).
const ACCOUNTS = [
  { key: "cash", type: "Cash", name: "Cash", opening: "12000.00" },
  { key: "sbi", type: "Bank", name: "SBI current ••1234", last4: "1234", opening: "150000.00",
    bank: { bankName: "SBI", branch: "Walajapet", ifsc: "SBIN0000963", micr: "632002011", accountKind: "Current" } },
  { key: "eb", type: "Wallet", name: "EB wallet", opening: "10110.00", low: "3000.00", walletKind: "Other" },
  { key: "pan", type: "Wallet", name: "PAN wallet", opening: "2000.00", low: "500.00", walletKind: "Other" },
  { key: "cert", type: "Wallet", name: "Certificate wallet", opening: "1296.00", low: "200.00", walletKind: "CSC" },
] as const;
type AccountKey = (typeof ACCOUNTS)[number]["key"];

async function reset() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await prisma.$executeRawUnsafe(`SELECT setval('bill_no_seq', 1, false)`); // BL- numbers start again at BL-0001
  await prisma.$executeRawUnsafe(`SELECT setval('cif_no_seq', 1, false)`); // customer IDs start again at CIF-000001
}

async function main() {
  await reset();
  const tenant = await prisma.tenant.create({ data: { name: "IPower Investments" } });
  const tenantId = tenant.id;
  await prisma.paymentOption.createMany({ data: defaultPayOptions(tenantId) });
  await prisma.dropdownOption.createMany({
    data: Object.entries(DEFAULT_DROPDOWN_VALUES).flatMap(([list, values]) => values.map((value, i) => ({ tenantId, list, value, sort: i + 1 }))),
  });

  // ── Users ──
  const hash = await hashPassword(PASSWORD);
  const users = {} as Record<"owner" | "admin" | "arun" | "divya", string>;
  for (const [key, name, username, role] of [
    ["owner", "Owner", "superadmin", "SuperAdmin"],
    ["admin", "R. Murali", "admin", "Admin"],
    ["arun", "Arun", "arun", "User"],
    ["divya", "Divya", "divya", "User"],
  ] as [keyof typeof users, string, string, Role][]) {
    const id = `usr_${username}`;
    await prisma.user.create({
      data: { id, name, email: `${username}@abc.demo`, emailVerified: true, username, displayUsername: username, role, tenantId },
    });
    await prisma.authAccount.create({
      data: { id: `acc_${username}`, accountId: id, providerId: "credential", userId: id, password: hash },
    });
    users[key] = id;
  }
  const staff = [users.arun, users.divya];

  // ── Accounts ──
  const acc = {} as Record<AccountKey, string>;
  for (const a of ACCOUNTS) {
    const row = await prisma.account.create({
      data: {
        tenantId, type: a.type, name: a.name, last4: "last4" in a ? a.last4 : null,
        openingBalance: a.opening, openingDate: today, lowBalanceThreshold: "low" in a ? a.low : null,
        isDefault: a.type !== "Wallet", ...("bank" in a ? a.bank : {}), ...("walletKind" in a ? { walletKind: a.walletKind } : {}), // account number not stored: the seed may run without DATA_ENCRYPTION_KEY
      },
    });
    acc[a.key] = row.id;
  }

  // ── E-Sevai service types and rates ──
  const fyStart = new Date(`${fy.slice(0, 4)}-04-01T00:00:00Z`);
  const eb = await prisma.serviceType.create({
    data: {
      tenantId, code: "EB", name: "EB bill", walletAccountId: acc.eb, allowBankPay: true,
      rates: {
        create: [
          // ₹1,000–₹1,999 and ₹30,000+ intentionally have no slab (open decision; entry is blocked).
          { minAmount: "0.01", maxAmount: "999.99", serviceCharge: "10.00", effectiveFrom: fyStart },
          { minAmount: "2000.00", maxAmount: "29999.99", serviceCharge: "20.00", effectiveFrom: fyStart },
        ],
      },
    },
  });
  const pan = await prisma.serviceType.create({
    data: {
      tenantId, code: "PAN", name: "PAN application", walletAccountId: acc.pan,
      rates: { create: { fixedCustomerAmount: "200.00", walletCost: "100.00", effectiveFrom: fyStart } },
    },
  });
  const cert = await prisma.serviceType.create({
    data: {
      tenantId, code: "CERT", name: "Certificate", walletAccountId: acc.cert,
      rates: { create: { fixedCustomerAmount: "100.00", walletCost: "12.00", effectiveFrom: fyStart } },
    },
  });
  // "Other" services: name typed on each entry, no rate (staff type what was collected).
  await prisma.serviceType.create({ data: { tenantId, code: "OTHER", name: "Other service", walletAccountId: acc.cert, allowBankPay: true } });

  // ── Customers ──
  const NAMED = [
    ["Rajesh Kumar", users.arun], ["Meena R", users.arun], ["Karthik V", users.divya],
    ["Lakshmi P", users.arun], ["Vijay A", users.divya], ["Suresh M", users.divya],
  ] as const;
  const OTHERS = [
    "Anitha S", "Balaji K", "Chitra N", "Dinesh R", "Ezhil M", "Gayathri V", "Hari Prasad", "Indira G",
    "Jayakumar T", "Kavitha S", "Logesh P", "Malathi R", "Naveen K", "Oviya M", "Prakash J", "Priyanka D",
    "Ramesh B", "Saranya L", "Senthil V", "Shanthi K", "Tamilselvan R", "Uma Maheswari", "Vasanth S",
    "Vimala P", "Yamuna R", "Arjun N", "Bhuvana T", "Ganesan M", "Kamala D", "Murugan S", "Nirmala A",
    "Pandian R", "Revathi K", "Sathish G",
  ];
  const customers: Record<string, { id: string; ownerId: string }> = {};
  let mobileSeq = 9840012000;
  for (const [name, ownerId] of [...NAMED, ...OTHERS.map((n, i) => [n, staff[i % 2]] as const)]) {
    const mobile = String(mobileSeq++);
    // Rajesh Kumar also has an office number (on WhatsApp).
    const numbers = name === "Rajesh Kumar" ? [{ number: mobile, isWhatsApp: false }, { number: "9445012002", isWhatsApp: true }] : [{ number: mobile, isWhatsApp: true }];
    const c = await prisma.customer.create({
      data: {
        tenantId, name, mobile, address: "Chennai", ownerId, ...(name === "Rajesh Kumar" && { email: "rajesh.k@example.com", address: "Chennai 600017" }),
        mobiles: { create: numbers.map((m, sort) => ({ tenantId, ...m, sort })) },
      },
    });
    customers[name] = { id: c.id, ownerId };
  }

  // ── Policies ──
  const policies: Record<string, Policy> = {};
  async function addPolicy(
    key: string, customer: string, productType: ProductType, partner: string, productName: string,
    policyNumber: string, premium: string, frequency: Frequency, startDate: Date, extra: { sumAssured?: string; termMonths?: number } = {},
  ) {
    const c = customers[customer];
    policies[key] = await prisma.policy.create({
      data: {
        tenantId, customerId: c.id, productType, partner, productName, policyNumber, premiumAmount: premium,
        frequency, startDate, ownerId: c.ownerId, ...extra,
      },
    });
    return policies[key];
  }
  async function renewal(p: Policy, dueDate: Date, status: "Due" | "Overdue" | "Paid" = "Due", paidOn?: Date) {
    return prisma.renewalItem.create({
      data: { tenantId, policyId: p.id, dueDate, premiumAmount: p.premiumAmount, status, paidOn },
    });
  }

  // Named customers (10 policies)
  const yearAgo = (d: Date) => addMonths(d, -12);
  await addPolicy("rajesh-sbi", "Rajesh Kumar", "Insurance", "SBI Life", "Smart Shield", "SBIL-7745120", "30000.00", "Yearly", yearAgo(addDays(today, 1)), { sumAssured: "5000000.00" });
  await addPolicy("rajesh-mf", "Rajesh Kumar", "MutualFund", "HDFC MF", "Flexi Cap SIP", "FOLIO-1102345", "5000.00", "Monthly", addMonths(today, -20));
  await addPolicy("rajesh-rd", "Rajesh Kumar", "PoRd", "Post Office", "RD", "RD 1124-778", "1000.00", "Monthly", addMonths(today, -14), { termMonths: 60 });
  await addPolicy("rajesh-td", "Rajesh Kumar", "PoTd", "Post Office", "TD 5 yr", "TD 2210-045", "100000.00", "OneTime", addMonths(today, -8), { termMonths: 60 });
  await addPolicy("rajesh-star", "Rajesh Kumar", "Insurance", "Star Health", "Comprehensive", "STAR-P-664120", "16800.00", "Yearly", addMonths(today, -8), { sumAssured: "1000000.00" });
  await addPolicy("meena-star", "Meena R", "Insurance", "Star Health", "Family Health Optima", "STAR-P-551872", "22400.00", "Yearly", yearAgo(addDays(today, -3)), { sumAssured: "500000.00" });
  await addPolicy("karthik-care", "Karthik V", "Insurance", "Care Health", "Care Supreme", "CARE-90021457", "18900.00", "Yearly", yearAgo(addDays(today, 3)), { sumAssured: "1000000.00" });
  await addPolicy("lakshmi-rd1", "Lakshmi P", "PoRd", "Post Office", "RD", "RD 2231-104", "1000.00", "Monthly", addMonths(today, -9), { termMonths: 60 });
  await addPolicy("lakshmi-rd2", "Lakshmi P", "PoRd", "Post Office", "RD", "RD 2231-105", "500.00", "Monthly", addMonths(today, -5), { termMonths: 60 });
  await addPolicy("vijay-sbi", "Vijay A", "Insurance", "SBI Life", "eShield Next", "SBIL-6612093", "12500.00", "Yearly", yearAgo(addDays(today, -38)), { sumAssured: "2500000.00" });

  await renewal(policies["rajesh-sbi"], addDays(today, 1));
  await renewal(policies["rajesh-star"], addMonths(today, 4));
  await renewal(policies["meena-star"], addDays(today, -3), "Overdue");
  await renewal(policies["karthik-care"], addDays(today, 3));
  await renewal(policies["vijay-sbi"], addDays(today, -38), "Overdue");

  // Other customers: 17 RD, 22 insurance, 7 MF, 4 TD/KVP/NSC, 4 SSA/PPF/SCSS/MIS = 54 policies
  const INSURERS = [
    ["SBI Life", "Smart Shield"], ["Star Health", "Family Health Optima"], ["Care Health", "Care Supreme"],
    ["LIC", "Jeevan Anand"], ["Star Health", "Senior Citizens Red Carpet"], ["SBI Life", "eWealth"],
  ];
  const others = [...OTHERS];
  let n = 0;
  const nextCustomer = () => others[n++ % others.length];
  const rdOthers: Policy[] = [];
  for (let i = 0; i < 17; i++) {
    const amt = pick(["500.00", "1000.00", "1000.00", "1500.00", "2000.00"]);
    const p = await addPolicy(`rd-${i}`, i === 0 ? "Suresh M" : nextCustomer(), "PoRd", "Post Office", "RD",
      `RD ${3100 + i}-${200 + i * 7}`, i === 0 ? "500.00" : amt, "Monthly", addMonths(today, -(3 + Math.floor(rand() * 20))), { termMonths: 60 });
    rdOthers.push(p);
  }
  // Insurance due dates: 4 more due this week, 3 more overdue, 5 paid by today's receipts, rest later.
  const insDue = [0, 2, 5, 6, -9, -15, -21];
  const insurance: Policy[] = [];
  for (let i = 0; i < 22; i++) {
    const [partner, product] = pick(INSURERS);
    const premium = (8000 + Math.floor(rand() * 30) * 500).toFixed(2);
    const due = i < insDue.length ? addDays(today, insDue[i]) : addDays(today, 10 + Math.floor(rand() * 290));
    const p = await addPolicy(`ins-${i}`, nextCustomer(), "Insurance", partner, product, `POL-${480000 + i * 137}`,
      premium, "Yearly", yearAgo(due), { sumAssured: "500000.00" });
    insurance.push(p);
    // policies 7–11 are paid today and 12 yesterday (see receipts); their renewals are created there
    if (i < 7 || i > 12) await renewal(p, due, due < today ? "Overdue" : "Due");
  }
  for (let i = 0; i < 7; i++) {
    await addPolicy(`mf-${i}`, nextCustomer(), "MutualFund", pick(["HDFC MF", "SBI MF", "Axis MF"]), pick(["Flexi Cap SIP", "Bluechip SIP", "ELSS SIP"]),
      `FOLIO-${2200000 + i * 911}`, pick(["1000.00", "2000.00", "3000.00"]), "Monthly", addMonths(today, -(2 + i)));
  }
  const schemeStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), Math.min(3, today.getUTCDate())));
  const tdThisMonth = await addPolicy("td-new", nextCustomer(), "PoTd", "Post Office", "TD 1 yr", "TD 2290-011", "50000.00", "OneTime", schemeStart, { termMonths: 12 });
  await addPolicy("kvp", nextCustomer(), "PoKvp", "Post Office", "KVP", "KVP 7781-09", "25000.00", "OneTime", addMonths(today, -6), { termMonths: 115 });
  await addPolicy("nsc", nextCustomer(), "PoNsc", "Post Office", "NSC", "NSC 4410-22", "20000.00", "OneTime", addMonths(today, -4), { termMonths: 60 });
  await addPolicy("td-old", nextCustomer(), "PoTd", "Post Office", "TD 2 yr", "TD 2240-150", "75000.00", "OneTime", addMonths(today, -10), { termMonths: 24 });
  // SSA / PPF: yearly deposit for 15 years (one due soon, one overdue); SCSS / MIS: one maturing this month, one matured last week.
  const ssa = await addPolicy("ssa", nextCustomer(), "PoSsa", "Post Office", "SSA", "SSA 5510-08", "12000.00", "Yearly", addMonths(addDays(today, 20), -36), { termMonths: 180 });
  await renewal(ssa, addDays(today, 20));
  const ppf = await addPolicy("ppf", nextCustomer(), "PoPpf", "Post Office", "PPF", "PPF 6620-14", "24000.00", "Yearly", addMonths(addDays(today, -12), -24), { termMonths: 180 });
  await renewal(ppf, addDays(today, -12), "Overdue");
  await addPolicy("scss", nextCustomer(), "PoScss", "Post Office", "SCSS", "SCSS 7730-02", "300000.00", "OneTime", addMonths(addDays(today, 18), -60), { termMonths: 60 });
  await addPolicy("mis", nextCustomer(), "PoMis", "Post Office", "MIS", "MIS 8840-31", "150000.00", "OneTime", addMonths(addDays(today, -6), -60), { termMonths: 60 });

  // RD schedules: instalment due at month-end; past months paid; current month per scenario; next 2 months due.
  const rdCurrent: Record<string, string> = {}; // policyId → current-month RenewalItem id
  for (const p of [...rdOthers, policies["rajesh-rd"], policies["lakshmi-rd1"], policies["lakshmi-rd2"]]) {
    for (let m = p.startDate; monthEnd(m) <= addMonths(monthEnd(today), 2); m = addMonths(m, 1)) {
      const due = monthEnd(m);
      const past = due < monthEnd(today);
      const r = await renewal(p, due, past ? "Paid" : "Due", past ? due : undefined);
      if (due.getTime() === monthEnd(today).getTime()) rdCurrent[p.id] = r.id;
    }
  }

  // ── Numbering ──
  let rcpt = 870, svc = 4410, exp = 136;
  const rcptNo = () => `RCPT-${String(++rcpt).padStart(4, "0")}`;
  const svcNo = () => `SVC-${++svc}`;
  const expNo = () => `EXP-${String(++exp).padStart(4, "0")}`;
  const nameOf = (p: Policy) => Object.entries(customers).find(([, c]) => c.id === p.customerId)![0];

  // ── Money helpers (all post through the Day Book library) ──
  async function receipt(tx: Tx, date: Date, p: Policy, amount: string, mode: PaymentMode, by: string, opts: { renewalItemId?: string; reference?: string } = {}) {
    const isRd = p.productType === "PoRd";
    const r = await tx.receipt.create({
      data: {
        tenantId, receiptNo: rcptNo(), fy: financialYear(date), receiptDate: date, txnDate: date, customerId: p.customerId, policyId: p.id,
        renewalItemId: opts.renewalItemId, amount, mode, accountId: mode === "Cash" ? acc.cash : acc.sbi,
        reference: opts.reference, rdStatus: isRd ? "Collected" : null, createdById: by,
        createdAt: new Date(date.getTime() + (4 + Math.floor(rand() * 7)) * 3_600_000), // 9:30 am–4:30 pm IST
      },
    });
    if (opts.renewalItemId) {
      await tx.renewalItem.update({ where: { id: opts.renewalItemId }, data: { status: "Paid", paidOn: date, paidReceiptId: r.id } });
    }
    if (isRd) {
      await tx.commission.create({
        data: { tenantId, sourceType: "RdReceipt", sourceNo: r.receiptNo, policyId: p.id, receiptId: r.id, earnedOn: date, ...poCommission("PoRd", amount) },
      });
    }
    await postReceipt(tx, r, { customerName: nameOf(p), policy: p });
    return r;
  }

  async function service(tx: Tx, date: Date, code: "EB" | "PAN" | "CERT", base: string, mode: PaymentMode, customerName: string, by: string, customerMobile?: string) {
    const type = { EB: eb, PAN: pan, CERT: cert }[code];
    const b = new D(base);
    const charge = code === "EB" ? new D(b.lt(1000) ? 10 : 20) : ZERO;
    const walletCost = code === "EB" ? b : new D(code === "PAN" ? 100 : 12);
    const customerAmount = code === "EB" ? b.plus(charge) : new D(code === "PAN" ? 200 : 100);
    const t = await tx.serviceTransaction.create({
      data: {
        tenantId, txnNo: svcNo(), txnDate: date, serviceTypeId: type.id, customerName, customerMobile, paidFromAccountId: type.walletAccountId,
        receivedAccountId: mode === "Cash" ? acc.cash : acc.sbi, baseAmount: b, serviceCharge: code === "EB" ? charge : customerAmount.minus(walletCost),
        walletCost, customerAmount, profit: customerAmount.minus(walletCost), paymentMode: mode,
        providerRef: code === "EB" ? `TNEB-${Math.floor(rand() * 90000) + 10000}` : null, createdById: by,
      },
    });
    await postServiceTransaction(tx, t, { serviceCode: code, serviceName: type.name });
  }

  const vendors: Record<string, string> = {};
  async function vendor(tx: Tx, name: string) {
    vendors[name] ??= (await tx.vendor.create({ data: { tenantId, name } })).id;
    return vendors[name];
  }

  async function expense(tx: Tx, date: Date, e: {
    category: string; description: string; amount: string; vendor: string; billNo: string; mode: PaymentMode;
    status: "Saved" | "Waiting" | "Approved"; level?: "None" | "Admin" | "SuperAdmin"; by: string; approvedBy?: string;
    paidBy?: "Company" | "Employee"; paidByName?: string; fromAccount?: AccountKey; notes?: string;
  }) {
    const paidBy = e.paidBy ?? "Company";
    const row = await tx.expense.create({
      data: {
        tenantId, expenseNo: expNo(), expenseDate: date, category: e.category, description: e.description, notes: e.notes ?? e.description, amount: e.amount,
        vendorId: await vendor(tx, e.vendor), billNo: e.billNo, paidBy, paidByName: e.paidByName, mode: e.mode,
        fromAccountId: paidBy === "Company" ? acc[e.fromAccount ?? "cash"] : null,
        repaymentStatus: paidBy === "Company" ? "NotNeeded" : "ToBeRepaid",
        status: e.status, approvalLevel: e.level ?? "None", approvedById: e.approvedBy, approvedAt: e.approvedBy ? now : null,
        createdById: e.by,
      },
    });
    // Company money moves once the expense is within limit or approved.
    if (paidBy === "Company" && e.status !== "Waiting") await postExpensePayment(tx, row, { vendorName: e.vendor, date, createdById: e.by });
    return row;
  }

  // ── History: earlier days (closed) ──
  const d9 = addDays(today, -9), d6 = addDays(today, -6);
  await db.$transaction(async (tx) => {
    await expense(tx, d9, { category: "Utilities", description: "Electricity bill – office", amount: "3100.00", vendor: "TANGEDCO", billNo: "EB-OFF-0926", mode: "UPI", fromAccount: "sbi", status: "Approved", level: "Admin", by: users.divya, approvedBy: users.admin });
    await expense(tx, d6, { category: "Utilities", description: "Internet – monthly", amount: "1180.00", vendor: "ACT Fibernet", billNo: "ACT-558120", mode: "UPI", fromAccount: "sbi", status: "Saved", by: users.admin });
    for (const [code, base, mode, who] of [
      ["EB", "640.00", "Cash", "Kumaran"], ["EB", "3400.00", "UPI", "Selvi"], ["EB", "920.00", "Cash", "Mani"],
      ["PAN", "200.00", "Cash", "Ravi"], ["PAN", "200.00", "UPI", "Geetha"], ["CERT", "100.00", "Cash", "Muthu"],
      ["CERT", "100.00", "Cash", "Latha"], ["CERT", "100.00", "Cash", "Babu"],
    ] as const) await service(tx, d6, code, base, mode, who, pick(staff));
    // TD opened this month: challan commission
    await tx.commission.create({
      data: { tenantId, sourceType: "Challan", sourceNo: "CH-2290011", policyId: tdThisMonth.id, earnedOn: tdThisMonth.startDate, ...poCommission("PoTd", "50000.00") },
    });
  }, { timeout: 60_000 });

  // Yesterday: receipts, RD cash deposited at PO, one UPI RD left Collected, E-Sevai, small expense.
  await db.$transaction(async (tx) => {
    const [y1, y2, y3] = rdOthers.slice(8, 11);
    const r1 = await receipt(tx, yesterday, y1, y1.premiumAmount.toFixed(2), "Cash", users.divya, { renewalItemId: rdCurrent[y1.id] });
    const r2 = await receipt(tx, yesterday, y2, y2.premiumAmount.toFixed(2), "Cash", users.arun, { renewalItemId: rdCurrent[y2.id] });
    await receipt(tx, yesterday, y3, y3.premiumAmount.toFixed(2), "UPI", users.arun, { renewalItemId: rdCurrent[y3.id], reference: "UTR 428811902231" });
    const lateIns = insurance[12];
    const lateItem = await renewal(lateIns, addDays(yesterday, -2), "Overdue");
    await receipt(tx, yesterday, lateIns, lateIns.premiumAmount.toFixed(2), "Cash", users.divya, { renewalItemId: lateItem.id });
    await renewal(lateIns, addMonths(lateItem.dueDate, 12));

    const total = r1.amount.plus(r2.amount);
    const dep = await tx.poDeposit.create({
      data: {
        tenantId, poReceiptNo: "7779 1102", depositDate: yesterday, amount: total, receiptsTotal: total, upiPortion: ZERO, createdById: users.admin,
        lines: { create: [r1, r2].map((r) => ({ receiptId: r.id, policyId: r.policyId!, amount: r.amount })) },
      },
    });
    await tx.receipt.updateMany({ where: { id: { in: [r1.id, r2.id] } }, data: { rdStatus: "Deposited" } });
    await tx.commission.updateMany({ where: { receiptId: { in: [r1.id, r2.id] } }, data: { poDepositId: dep.id } });
    await postPoDeposit(tx, dep, { accountId: acc.cash, mode: "Cash", receiptCount: 2 });

    // Rajesh Kumar's EB bill, matched to his customer record by mobile number.
    await service(tx, yesterday, "EB", "760.00", "Cash", "Rajesh Kumar", users.arun, "9840012000");
    await service(tx, yesterday, "PAN", "200.00", "Cash", "Deepa", users.divya);
    await service(tx, yesterday, "CERT", "100.00", "UPI", "Kannan", users.arun);
    // Surplus cash banked (contra: cash out, bank in — never an expense)
    await post(tx, {
      tenantId, entryDate: yesterday, sourceType: "Contra", sourceId: "seed-deposit-to-bank", createdById: users.admin,
      lines: [
        { key: "out", accountId: acc.cash, direction: "Out", amount: "15000.00", entryType: "DepositToBank", mode: "Cash", particulars: "Cash deposited to SBI ••1234" },
        { key: "in", accountId: acc.sbi, direction: "In", amount: "15000.00", entryType: "DepositToBank", mode: "Cash", particulars: "Cash deposited to SBI ••1234" },
      ],
    });
    await expense(tx, yesterday, { category: "Office", description: "Tea and snacks", amount: "450.00", vendor: "Ganesh Tea Stall", billNo: "GTS-221", mode: "Cash", status: "Saved", by: users.divya });
  }, { timeout: 60_000 });

  // Owner-paid RD slips (owner paid at the PO; customers still owe). No company money moves.
  await db.$transaction(async (tx) => {
    for (const [slipNo, p, poNo] of [["OWN-0013", rdOthers[0], "7780 4415"], ["OWN-0014", policies["rajesh-rd"], "7781 2290"]] as const) {
      await tx.ownerPaidSlip.create({
        data: {
          tenantId, slipNo, policyId: p.id, customerId: p.customerId, renewalItemId: rdCurrent[p.id],
          month: monthEnd(today), amount: p.premiumAmount, poReceiptNo: poNo, createdById: users.admin,
        },
      });
      await tx.renewalItem.update({ where: { id: rdCurrent[p.id] }, data: { status: "Paid", paidOn: yesterday } });
      await tx.commission.create({
        data: { tenantId, sourceType: "RdReceipt", sourceNo: poNo, policyId: p.id, earnedOn: yesterday, ...poCommission("PoRd", p.premiumAmount) },
      });
    }
  });

  // ── Fix account openings so today opens at the target balances, then close earlier days ──
  const history = await prisma.dayBookEntry.findMany({ where: { tenantId, entryDate: { lt: today } } });
  const firstDay = history.reduce((min, e) => (e.entryDate < min ? e.entryDate : min), today);
  for (const a of ACCOUNTS) {
    const net = history
      .filter((e) => e.accountId === acc[a.key])
      .reduce((s, e) => (e.direction === "In" ? s.plus(e.amount) : s.minus(e.amount)), ZERO);
    await prisma.account.update({ where: { id: acc[a.key] }, data: { openingBalance: new D(a.opening).minus(net), openingDate: firstDay } });
  }
  for (let d = firstDay; d < today; d = addDays(d, 1)) {
    if (!history.some((e) => e.entryDate.getTime() === d.getTime())) continue;
    const rows = await accountDay(db as unknown as Tx, tenantId, d);
    for (const r of rows) {
      await prisma.dayClose.create({
        data: {
          tenantId, accountId: r.accountId, date: d, opening: r.opening, totalIn: r.totalIn, totalOut: r.totalOut,
          computed: r.closing, physical: r.closing, difference: ZERO, status: "Closed",
          cashBySource: r.type === "Cash" ? { PostOffice: "0.00", GRM: r.closing.toFixed(2), ESevai: "0.00", PAN: "0.00", Others: "0.00" } : undefined,
          verifiedById: users.admin, verifiedAt: now, closedById: users.admin, closedAt: now,
        },
      });
    }
  }

  // ── Today (open): 12 receipts, 8 E-Sevai entries, expenses ──
  await db.$transaction(async (tx) => {
    // 7 RD instalments: 4 cash, 3 UPI — all Collected, waiting for the PO deposit
    const rdModes: PaymentMode[] = ["Cash", "Cash", "UPI", "Cash", "UPI", "Cash", "UPI"];
    for (let i = 0; i < 7; i++) {
      const p = rdOthers[1 + i];
      await receipt(tx, today, p, p.premiumAmount.toFixed(2), rdModes[i], staff[i % 2], {
        renewalItemId: rdCurrent[p.id], reference: rdModes[i] === "UPI" ? `UTR 4291${100000 + i * 7331}` : undefined,
      });
    }
    // 5 insurance renewals paid today
    const insModes: [PaymentMode, string?][] = [["UPI", "UTR 429155021877"], ["Cash"], ["Cheque", "CHQ 004512"], ["Cash"], ["UPI", "UTR 429155098310"]];
    for (let i = 0; i < 5; i++) {
      const p = insurance[7 + i];
      const item = await renewal(p, addDays(today, -(1 + i * 2)), "Overdue");
      await receipt(tx, today, p, p.premiumAmount.toFixed(2), insModes[i][0], staff[i % 2], { renewalItemId: item.id, reference: insModes[i][1] });
      await renewal(p, addMonths(item.dueDate, 12));
    }

    for (const [code, base, mode, who] of [
      ["EB", "850.00", "Cash", "Selvam"], ["EB", "2450.00", "UPI", "Padma"], ["EB", "640.00", "Cash", "Raja"],
      ["EB", "2150.00", "Cash", "Kumar"], ["PAN", "200.00", "Cash", "Vinoth"], ["PAN", "200.00", "Cash", "Sangeetha"],
      ["CERT", "100.00", "Cash", "Elango"], ["CERT", "100.00", "UPI", "Bharathi"],
    ] as const) await service(tx, today, code, base, mode, who, pick(staff));

    await expense(tx, today, { category: "Rent", description: "Office rent – " + today.toLocaleString("en-IN", { month: "long", timeZone: "UTC" }), amount: "25000.00", vendor: "K. Srinivasan (landlord)", billNo: `RENT-${isoDate(today).slice(0, 7)}`, mode: "Cheque", fromAccount: "sbi", status: "Approved", level: "SuperAdmin", by: users.admin, approvedBy: users.owner });
    await expense(tx, today, { category: "Equipment", description: "Laptop", amount: "38000.00", vendor: "Croma", billNo: "CR-55821", mode: "Bank", fromAccount: "sbi", status: "Waiting", level: "SuperAdmin", by: users.admin });
    await expense(tx, today, { category: "Repairs", description: "Printer repair", amount: "4800.00", vendor: "Sri Murugan Computers", billNo: "SMC-1182", mode: "Cash", status: "Waiting", level: "Admin", by: users.divya });
    await expense(tx, today, { category: "Travel", description: "Auto fare – head post office for RD deposits", amount: "350.00", vendor: "Auto (cash)", billNo: "AUTO-1012", mode: "Cash", status: "Saved", by: users.arun, paidBy: "Employee", paidByName: "Arun" });
  }, { timeout: 60_000 });

  // ── Insurer and MF commission this month (from partner statements) ──
  const commissionDay = new Date(Math.min(today.getTime(), Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 5)));
  for (const [ref, gross] of [["SBI Life stmt", "28500.00"], ["Star Health stmt", "19200.00"], ["Care Health stmt", "14600.00"], ["HDFC MF stmt", "7700.00"]] as const) {
    const g = new D(gross), tds = g.times("0.02").toDecimalPlaces(2);
    await prisma.commission.create({
      data: { tenantId, sourceType: "Partner", sourceNo: ref, earnedOn: commissionDay, baseAmount: g, rate: 1, gross: g, tdsRate: "0.02", tds, net: g.minus(tds), status: "Received", receivedOn: commissionDay },
    });
  }

  // ── Leads and calls ──
  // [lead no, first name, last name, gender, business type, status, owner, created days ago, interested product, 2nd mobile?]
  type Seed = [string, string, string, "Female" | "Male", "Direct" | "WalkIn" | "Referral" | "Website" | "SocialMedia", "Interested" | "NotInterested" | "CallBack", string, number, string, boolean?];
  const LEADS: Seed[] = [
    ["L-2017", "Kumaravel", "S", "Male", "Referral", "Interested", users.divya, -20, "LIC Jeevan Anand"],
    ["L-2018", "Nandhini", "R", "Female", "Website", "NotInterested", users.divya, -18, "Star Health Family Health Optima"],
    ["L-2019", "Sanjay", "P", "Male", "Direct", "NotInterested", users.arun, -16, "NSC"],
    ["L-2020", "Fathima", "B", "Female", "WalkIn", "Interested", users.divya, -14, "Post Office RD"],
    ["L-2021", "Gopinath", "V", "Male", "Website", "CallBack", users.arun, -12, "SBI Life Smart Shield"],
    ["L-2022", "Harini", "K", "Female", "SocialMedia", "Interested", users.divya, -10, "Care Health Care Supreme"],
    ["L-2023", "Iniyan", "M", "Male", "Website", "CallBack", users.arun, -8, "HDFC MF Flexi Cap SIP"],
    ["L-2024", "Janani", "S", "Female", "Referral", "Interested", users.divya, -6, "Post Office TD"],
    ["L-2025", "Revathi", "M", "Female", "SocialMedia", "CallBack", users.arun, -5, "SBI Life eWealth", true],
    ["L-2026", "Selvakumar", "T", "Male", "WalkIn", "CallBack", users.divya, -3, "KVP"],
    ["L-2027", "Vignesh", "P", "Male", "Direct", "CallBack", users.arun, -1, "Star Health Comprehensive"],
    ["L-2028", "Ganesh", "K", "Male", "Referral", "Interested", users.arun, 0, "Care Health Care Supreme"],
    ["L-2029", "Anitha", "Suresh", "Female", "Website", "Interested", users.divya, 0, "Post Office RD"],
    ["L-2030", "Mohammed", "I", "Male", "WalkIn", "CallBack", users.divya, 0, "Post Office RD"],
    ["L-2031", "Priya", "S", "Female", "Website", "CallBack", users.arun, 0, "Star Health Family Health Optima"],
  ];
  const REFERRERS = ["Rajesh Kumar", "Meena R", "Karthik V"];
  const STAGE: Record<string, "Quotation" | "Customer"> = { "L-2017": "Customer", "L-2022": "Quotation", "L-2028": "Quotation" };
  const leads: Record<string, string> = {};
  for (const [i, [leadNo, firstName, lastName, gender, source, status, ownerId, day, interest, second]] of LEADS.entries()) {
    const created = new Date(now.getTime() + day * 86_400_000 - 3_600_000);
    const mobile = String(9790050000 + Number(leadNo.slice(2)));
    const numbers = [{ number: mobile, isWhatsApp: true }, ...(second ? [{ number: String(9840070000 + Number(leadNo.slice(2))), isWhatsApp: false }] : [])];
    const l = await prisma.lead.create({
      data: {
        tenantId, leadNo, name: `${firstName} ${lastName}`, firstName, lastName, gender, dob: new Date(Date.UTC(1965 + (i * 7) % 35, (i * 5) % 12, 1 + (i * 3) % 27)),
        mobile, onWhatsApp: true, source, referrerName: source === "Referral" ? REFERRERS[i % REFERRERS.length] : null, status, stage: STAGE[leadNo] ?? "Lead", ownerId,
        interest, address: i % 3 === 0 ? "Chennai" : null, notInterestedReason: status === "NotInterested" ? "Already has a policy" : null, createdAt: created,
        mobiles: { create: numbers.map((m, sort) => ({ tenantId, ...m, sort })) },
      },
    });
    leads[leadNo] = l.id;
  }
  const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
  await prisma.call.createMany({
    data: [
      // Open lead calls (3): one overdue for Arun → blocking reminder on login
      { tenantId, leadId: leads["L-2025"], ownerId: users.arun, dueAt: hours(-0.5), note: "Wants health cover for parents; call back" },
      { tenantId, leadId: leads["L-2031"], ownerId: users.arun, dueAt: hours(2), note: "Website enquiry – term plan" },
      { tenantId, leadId: leads["L-2030"], ownerId: users.divya, dueAt: hours(3), note: "Walk-in; asked for RD details" },
      // Renewal follow-ups (Divya): one later today, one tomorrow
      { tenantId, policyId: policies["karthik-care"].id, ownerId: policies["karthik-care"].ownerId, dueAt: hours(4), note: "Promised to pay by Friday" },
      { tenantId, policyId: policies["vijay-sbi"].id, ownerId: policies["vijay-sbi"].ownerId, dueAt: hours(26), note: "38 days overdue – remind about the grace period" },
      // History
      { tenantId, leadId: leads["L-2025"], ownerId: users.arun, dueAt: hours(-50), outcome: "Interested", outcomeNote: "Send options", completedAt: hours(-50) },
      { tenantId, leadId: leads["L-2019"], ownerId: users.arun, dueAt: hours(-300), outcome: "NotInterested", outcomeNote: "Already has a policy", completedAt: hours(-300) },
      { tenantId, leadId: leads["L-2021"], ownerId: users.arun, dueAt: hours(-30), outcome: "NoAnswer", completedAt: hours(-30) },
    ],
  });
  // Lead L-2021 was not reachable yesterday: its next call is booked for tomorrow.
  await prisma.call.create({ data: { tenantId, leadId: leads["L-2021"], ownerId: users.arun, dueAt: hours(22), note: "No answer yesterday" } });
  await prisma.quotation.create({
    data: {
      tenantId, quoteNo: "Q-0416", leadId: leads["L-2028"], customerName: "Ganesh K", mobile: String(9790050000 + 2028),
      validUpto: addDays(today, 15), subtotal: "24000.00", gstTotal: "4320.00", total: "28320.00", ownerId: users.arun,
      items: { create: { category: "Health", insurer: "Care Health", productName: "Care Supreme", sumInsured: "1000000.00", premium: "24000.00", gstRate: "18.00", gstAmount: "4320.00", total: "28320.00" } },
    },
  });

  // ── Settings → Products and schemes; demo policies linked to it ──
  await seedProducts(tenantId, { admin: users.admin, owner: users.owner });
  await linkPolicies(tenantId);

  // ── Other income today (P&L): insurer incentives received in SBI ──
  await db.$transaction((tx) => post(tx, {
    tenantId, entryDate: today, sourceType: "Manual", sourceId: "seed-other-income", createdById: users.admin,
    lines: [{ key: "in", accountId: acc.sbi, direction: "In", amount: "24000.00", entryType: "OtherIncome", mode: "Bank", particulars: "Other income · Insurer incentives (September statements)", productCategory: "Other income", notes: "Insurer incentives (September statements)" }],
  }));

  // ── Summary ──
  const rows = await accountDay(db as unknown as Tx, tenantId, today);
  console.log(`Seeded ${tenant.name} for ${isoDate(today)}`);
  for (const r of rows) console.log(`  ${r.name.padEnd(20)} opening ${r.opening.toFixed(2).padStart(10)}  in ${r.totalIn.toFixed(2).padStart(10)}  out ${r.totalOut.toFixed(2).padStart(10)}  closing ${r.closing.toFixed(2).padStart(10)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
