-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SuperAdmin', 'Admin', 'User');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('Website', 'WalkIn', 'Partner', 'Call', 'Referral');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('New', 'CallScheduled', 'Interested', 'NotInterested', 'Quoted', 'Converted');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('Interested', 'NoAnswer', 'NotInterested');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('Draft', 'Accepted');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('Draft', 'ConsentPending', 'ConsentGiven', 'Issued');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('Sent', 'Given', 'Declined', 'Expired', 'Withdrawn');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('Insurance', 'MutualFund', 'PoRd', 'PoTd', 'PoKvp', 'PoNsc');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('Monthly', 'Quarterly', 'HalfYearly', 'Yearly', 'OneTime');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('Active', 'Lapsed', 'Matured');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('Due', 'Overdue', 'Paid', 'Lapsed');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('Cash', 'UPI', 'Cheque', 'Bank', 'Card');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('Saved', 'Cancelled');

-- CreateEnum
CREATE TYPE "RdStatus" AS ENUM ('Collected', 'Deposited', 'Verified');

-- CreateEnum
CREATE TYPE "OwnerPaidSlipStatus" AS ENUM ('CustomerOwes', 'CollectedReturnToOwner', 'Settled', 'Cancelled');

-- CreateEnum
CREATE TYPE "CommissionSourceType" AS ENUM ('RdReceipt', 'Challan', 'Partner');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('Expected', 'Received', 'Cancelled');

-- CreateEnum
CREATE TYPE "ServiceTxnStatus" AS ENUM ('Saved', 'Cancelled');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('Cash', 'Bank', 'Wallet');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('Saved', 'Waiting', 'Approved', 'Rejected', 'Cancelled');

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('None', 'Admin', 'SuperAdmin');

-- CreateEnum
CREATE TYPE "PaidBy" AS ENUM ('Company', 'Employee', 'Owner');

-- CreateEnum
CREATE TYPE "RepaymentStatus" AS ENUM ('NotNeeded', 'ToBeRepaid', 'Repaid');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('In', 'Out');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('Collection', 'ServiceCollection', 'ServiceCost', 'WalletRecharge', 'Expense', 'ExpenseRepayment', 'Withdrawal', 'DepositToBank', 'DepositToPo', 'OwnerReturn', 'Adjustment');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('Receipt', 'ServiceTransaction', 'Expense', 'PoDeposit', 'OwnerPaidSlip', 'Contra', 'WalletRecharge', 'Manual');

-- CreateEnum
CREATE TYPE "DayCloseStatus" AS ENUM ('Open', 'Closed');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WhatsApp', 'SMS', 'Email');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "username" TEXT,
    "displayUsername" TEXT,
    "role" "Role" NOT NULL DEFAULT 'User',
    "tenantId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "source" "LeadSource" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'New',
    "interest" TEXT,
    "notInterestedReason" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "outcome" "CallOutcome",
    "outcomeNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteNo" TEXT NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'Draft',
    "validUpto" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "gstTotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sumInsured" DECIMAL(14,2),
    "premium" DECIMAL(12,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalNo" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "premium" DECIMAL(12,2) NOT NULL,
    "panMasked" TEXT,
    "aadhaarLast4" TEXT,
    "policyNumber" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'Draft',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "proposalId" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'Sent',
    "otpVerifiedOn" TIMESTAMP(3),
    "ipAddress" TEXT,
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "panMasked" TEXT,
    "aadhaarLast4" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "proposalId" TEXT,
    "productType" "ProductType" NOT NULL,
    "partner" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "premiumAmount" DECIMAL(12,2) NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "termMonths" INTEGER,
    "sumAssured" DECIMAL(14,2),
    "status" "PolicyStatus" NOT NULL DEFAULT 'Active',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "premiumAmount" DECIMAL(12,2) NOT NULL,
    "status" "RenewalStatus" NOT NULL DEFAULT 'Due',
    "paidReceiptId" TEXT,
    "paidOn" DATE,
    "lastReminderAt" TIMESTAMP(3),

    CONSTRAINT "RenewalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "receiptDate" DATE NOT NULL,
    "customerId" TEXT NOT NULL,
    "policyId" TEXT,
    "renewalItemId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "accountId" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "isPassThrough" BOOLEAN NOT NULL DEFAULT true,
    "rdStatus" "RdStatus",
    "ownerPaid" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'Saved',
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerPaidSlip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slipNo" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "renewalItemId" TEXT,
    "month" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "poReceiptNo" TEXT NOT NULL,
    "status" "OwnerPaidSlipStatus" NOT NULL DEFAULT 'CustomerOwes',
    "closedByReceiptId" TEXT,
    "returnedEntryId" TEXT,
    "confirmedById" TEXT,
    "confirmedOn" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPaidSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoDeposit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poReceiptNo" TEXT NOT NULL,
    "depositDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiptsTotal" DECIMAL(12,2) NOT NULL,
    "upiPortion" DECIMAL(12,2) NOT NULL,
    "adjustmentReason" TEXT,
    "adjustmentNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoDepositLine" (
    "id" TEXT NOT NULL,
    "poDepositId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PoDepositLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" "CommissionSourceType" NOT NULL,
    "sourceNo" TEXT NOT NULL,
    "policyId" TEXT,
    "receiptId" TEXT,
    "poDepositId" TEXT,
    "earnedOn" DATE NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "tdsRate" DECIMAL(6,4) NOT NULL,
    "tds" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'Expected',
    "receivedOn" DATE,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "walletAccountId" TEXT NOT NULL,
    "allowBankPay" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRate" (
    "id" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "minAmount" DECIMAL(12,2),
    "maxAmount" DECIMAL(12,2),
    "serviceCharge" DECIMAL(12,2),
    "walletCost" DECIMAL(12,2),
    "fixedCustomerAmount" DECIMAL(12,2),
    "effectiveFrom" DATE NOT NULL,

    CONSTRAINT "ServiceRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "txnNo" TEXT NOT NULL,
    "txnDate" DATE NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerMobile" TEXT,
    "paidFromAccountId" TEXT NOT NULL,
    "receivedAccountId" TEXT NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "serviceCharge" DECIMAL(12,2) NOT NULL,
    "walletCost" DECIMAL(12,2) NOT NULL,
    "customerAmount" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "providerRef" TEXT,
    "paymentMode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "status" "ServiceTxnStatus" NOT NULL DEFAULT 'Saved',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "last4" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "openingDate" DATE NOT NULL,
    "lowBalanceThreshold" DECIMAL(12,2),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expenseNo" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billPhotoPath" TEXT,
    "paidBy" "PaidBy" NOT NULL DEFAULT 'Company',
    "paidByName" TEXT,
    "mode" "PaymentMode" NOT NULL,
    "fromAccountId" TEXT,
    "repaymentStatus" "RepaymentStatus" NOT NULL DEFAULT 'NotNeeded',
    "repaidOn" DATE,
    "repaidFromAccountId" TEXT,
    "status" "ExpenseStatus" NOT NULL,
    "approvalLevel" "ApprovalLevel" NOT NULL DEFAULT 'None',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayBookEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "direction" "Direction" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "entryType" "EntryType" NOT NULL,
    "mode" "PaymentMode",
    "isPassThrough" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" "SourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceNo" TEXT,
    "particulars" TEXT NOT NULL,
    "productCategory" TEXT,
    "scheme" TEXT,
    "notes" TEXT,
    "reversalOfId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayClose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "opening" DECIMAL(14,2) NOT NULL,
    "totalIn" DECIMAL(14,2) NOT NULL,
    "totalOut" DECIMAL(14,2) NOT NULL,
    "computed" DECIMAL(14,2) NOT NULL,
    "physical" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "cashBySource" JSONB,
    "status" "DayCloseStatus" NOT NULL DEFAULT 'Open',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DayClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "to" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Sent (mock)',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_leadNo_key" ON "Lead"("tenantId", "leadNo");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_mobile_key" ON "Lead"("tenantId", "mobile");

-- CreateIndex
CREATE INDEX "Call_ownerId_outcome_dueAt_idx" ON "Call"("ownerId", "outcome", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_tenantId_quoteNo_key" ON "Quotation"("tenantId", "quoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_quotationId_key" ON "Proposal"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_tenantId_proposalNo_key" ON "Proposal"("tenantId", "proposalNo");

-- CreateIndex
CREATE INDEX "Customer_tenantId_mobile_idx" ON "Customer"("tenantId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_proposalId_key" ON "Policy"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_tenantId_policyNumber_key" ON "Policy"("tenantId", "policyNumber");

-- CreateIndex
CREATE INDEX "RenewalItem_tenantId_status_dueDate_idx" ON "RenewalItem"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Receipt_tenantId_receiptDate_idx" ON "Receipt"("tenantId", "receiptDate");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_tenantId_receiptNo_fy_key" ON "Receipt"("tenantId", "receiptNo", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPaidSlip_tenantId_slipNo_key" ON "OwnerPaidSlip"("tenantId", "slipNo");

-- CreateIndex
CREATE UNIQUE INDEX "PoDepositLine_receiptId_key" ON "PoDepositLine"("receiptId");

-- CreateIndex
CREATE INDEX "Commission_tenantId_earnedOn_idx" ON "Commission"("tenantId", "earnedOn");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_tenantId_code_key" ON "ServiceType"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTransaction_tenantId_txnNo_key" ON "ServiceTransaction"("tenantId", "txnNo");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_tenantId_name_key" ON "Vendor"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_expenseNo_key" ON "Expense"("tenantId", "expenseNo");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_vendorId_billNo_key" ON "Expense"("tenantId", "vendorId", "billNo");

-- CreateIndex
CREATE UNIQUE INDEX "DayBookEntry_reversalOfId_key" ON "DayBookEntry"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "DayBookEntry_idempotencyKey_key" ON "DayBookEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DayBookEntry_tenantId_entryDate_idx" ON "DayBookEntry"("tenantId", "entryDate");

-- CreateIndex
CREATE INDEX "DayBookEntry_accountId_entryDate_idx" ON "DayBookEntry"("accountId", "entryDate");

-- CreateIndex
CREATE INDEX "DayBookEntry_sourceType_sourceId_idx" ON "DayBookEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DayClose_tenantId_accountId_date_key" ON "DayClose"("tenantId", "accountId", "date");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalItem" ADD CONSTRAINT "RenewalItem_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPaidSlip" ADD CONSTRAINT "OwnerPaidSlip_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPaidSlip" ADD CONSTRAINT "OwnerPaidSlip_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPaidSlip" ADD CONSTRAINT "OwnerPaidSlip_closedByReceiptId_fkey" FOREIGN KEY ("closedByReceiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoDepositLine" ADD CONSTRAINT "PoDepositLine_poDepositId_fkey" FOREIGN KEY ("poDepositId") REFERENCES "PoDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoDepositLine" ADD CONSTRAINT "PoDepositLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_poDepositId_fkey" FOREIGN KEY ("poDepositId") REFERENCES "PoDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRate" ADD CONSTRAINT "ServiceRate_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTransaction" ADD CONSTRAINT "ServiceTransaction_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "DayBookEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
