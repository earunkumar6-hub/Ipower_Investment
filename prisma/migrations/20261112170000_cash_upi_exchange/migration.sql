-- Owner change list #22: cash / UPI exchange in the Day Book – a contra between office cash and a bank account
-- (cash given for UPI received, or UPI sent for cash received). Never income or expense.
ALTER TYPE "EntryType" ADD VALUE 'CashUpiExchange';
