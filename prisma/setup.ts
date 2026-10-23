// Live install: the company, settings lists, product catalogue, office cash, one E-Sevai wallet and the
// owner's login – no demo customers or money. Runs once on an empty database (docker-entrypoint.sh,
// INSTALL_MODE=live). Bank accounts, more wallets and staff logins are added by the owner in Settings.
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/db";
import { financialYear, istToday } from "@/lib/dates";
import { defaultPayOptions } from "@/lib/payment-options";
import { DEFAULT_DROPDOWN_VALUES } from "@/lib/dropdowns";
import { seedProducts } from "./seed-products";

async function main() {
  if ((await prisma.tenant.count()) > 0) throw new Error("Setup refused: the database already has a company");
  const name = process.env.SETUP_OWNER_NAME?.trim() || "Owner";
  const username = process.env.SETUP_OWNER_USERNAME?.trim().toLowerCase() ?? "";
  const password = process.env.SETUP_OWNER_PASSWORD ?? "";
  if (!/^[a-z0-9._]{3,30}$/.test(username)) throw new Error("Set SETUP_OWNER_USERNAME in .env (3–30 letters, digits, dot or underscore)");
  if (password.length < 8) throw new Error("Set SETUP_OWNER_PASSWORD in .env (at least 8 characters)");
  // Opening balances can only be given when an account is created, so cash and the wallet take theirs from .env.
  const opening = (key: string) => {
    const v = process.env[key]?.trim() || "0";
    if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error(`${key} must be an amount like 12000 or 12000.50`);
    return v;
  };
  const cashOpening = opening("SETUP_CASH_OPENING");
  const walletOpening = opening("SETUP_WALLET_OPENING");

  const today = istToday();
  const fyStart = new Date(`${financialYear(today).slice(0, 4)}-04-01T00:00:00Z`);
  const hash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const { id: tenantId } = await tx.tenant.create({ data: { name: "IPower Investments" } });
    await tx.paymentOption.createMany({ data: defaultPayOptions(tenantId) });
    await tx.dropdownOption.createMany({
      data: Object.entries(DEFAULT_DROPDOWN_VALUES).flatMap(([list, values]) => values.map((value, i) => ({ tenantId, list, value, sort: i + 1 }))),
    });

    const ownerId = "usr_owner";
    await tx.user.create({ data: { id: ownerId, name, email: `${username}@ipower.local`, emailVerified: true, username, displayUsername: username, role: "SuperAdmin", tenantId } });
    await tx.authAccount.create({ data: { id: "acc_owner", accountId: ownerId, providerId: "credential", userId: ownerId, password: hash } });

    await tx.account.create({ data: { tenantId, type: "Cash", name: "Cash", openingBalance: cashOpening, openingDate: today, isDefault: true } });
    const wallet = await tx.account.create({ data: { tenantId, type: "Wallet", name: "E-Sevai wallet", walletKind: "ESevai", openingBalance: walletOpening, openingDate: today } });

    // E-Sevai services and rates (the screens can't add these). Same rates as the demo – EB ₹1,000–1,999 and ₹30,000+ have no slab.
    const walletAccountId = wallet.id;
    await tx.serviceType.create({ data: { tenantId, code: "EB", name: "EB bill", walletAccountId, allowBankPay: true, rates: { create: [
      { minAmount: "0.01", maxAmount: "999.99", serviceCharge: "10.00", effectiveFrom: fyStart },
      { minAmount: "2000.00", maxAmount: "29999.99", serviceCharge: "20.00", effectiveFrom: fyStart },
    ] } } });
    await tx.serviceType.create({ data: { tenantId, code: "PAN", name: "PAN application", walletAccountId, rates: { create: { fixedCustomerAmount: "200.00", walletCost: "100.00", effectiveFrom: fyStart } } } });
    await tx.serviceType.create({ data: { tenantId, code: "CERT", name: "Certificate", walletAccountId, rates: { create: { fixedCustomerAmount: "100.00", walletCost: "12.00", effectiveFrom: fyStart } } } });
    await tx.serviceType.create({ data: { tenantId, code: "OTHER", name: "Other service", walletAccountId, allowBankPay: true } });
  }, { timeout: 60_000 });

  const tenant = await prisma.tenant.findFirstOrThrow();
  await seedProducts(tenant.id, { admin: "usr_owner", owner: "usr_owner" });
  console.log(`Live setup done: ${tenant.name}, owner login "${username}"`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
