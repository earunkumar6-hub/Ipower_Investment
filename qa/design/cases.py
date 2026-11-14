"""GRM QA – Phase 2 test design. Single source of truth for test case IDs.

python qa/design/cases.py  →  writes qa/design/test-cases.json (read by the specs' report step) and
D:/Projects/GRM/QA/GRM_QA_Phase2_Test_Design.xlsx.
Automation: Auto = Playwright spec, Blocked = feature not in the app (see Phase 1 questions), Manual = needs a person.
"""
import json
from pathlib import Path

H, N, B, R, S, P, C, I, X, J = "Happy", "Negative", "Boundary", "Role", "Security", "Performance", "Concurrency", "Integrity", "Browser", "Journey"
A, BL, M = "Auto", "Blocked", "Manual"

# (id, module, requirement ids, type, priority, title, steps, expected, automation, spec file)
CASES = [
    # ── AUTH ────────────────────────────────────────────────────────────────────────────────────────────────
    ("AUTH-01", "AUTH", "Brief", H, "P1", "Sign in with a valid login", "Open /login; enter admin / seed password; Sign in", "Dashboard opens; header says 'Signed in as R. Murali (Admin)'", A, "auth"),
    ("AUTH-02", "AUTH", "CL-31", H, "P2", "Login page shows no demo users or password", "Open /login", "No usernames (superadmin/admin/arun/divya) and no 'demo1234' on the page", A, "auth"),
    ("AUTH-03", "AUTH", "Brief", N, "P1", "Wrong password is refused", "Enter admin + wrong password", "Stays on /login with an error; no session row created", A, "auth"),
    ("AUTH-04", "AUTH", "Brief", H, "P1", "Sign out ends the session", "Sign in; Sign out; open /dashboard", "Redirected to /login", A, "auth"),
    ("AUTH-05", "AUTH", "NR-05", B, "P1", "Idle session expires", "Sign in; set the session's expiresAt in the past (test DB); open /customers", "Redirected to /login", A, "auth"),
    ("AUTH-06", "AUTH", "NR-05", B, "P2", "Session lasts 1 hour of inactivity", "Sign in; read Session row", "expiresAt − createdAt = 60 minutes", A, "auth"),
    ("AUTH-07", "AUTH", "Brief", N, "P2", "Switched-off login can't sign in", "Super Admin sets Arun's login Off; Arun signs in", "Sign-in refused with 'switched off' message", A, "auth"),
    ("AUTH-08", "AUTH", "Brief", B, "P3", "Blank username / password", "Submit the login form empty", "Not signed in; stays on /login", A, "auth"),
    ("AUTH-20", "AUTH", "CL-10", R, "P1", "User sees every staff member's customers", "Sign in as Arun; open Partners / Customers", "List count equals all customers in DB (not only Arun's)", A, "auth"),
    ("AUTH-21", "AUTH", "CL-10", R, "P1", "User can open and edit another staff member's customer", "As Arun open a customer owned by Divya", "Page opens; 'Edit details' is offered", A, "auth"),
    ("AUTH-22", "AUTH", "CL-10", R, "P1", "User sees every receipt", "As Arun open Receipts", "Receipts entered by Divya are listed", A, "auth"),
    ("AUTH-23", "AUTH", "CL-10", R, "P2", "User sees every expense", "As Arun open Expenses", "Expenses entered by others are listed", A, "auth"),
    ("AUTH-24", "AUTH", "CL-04", R, "P1", "Admin and User can't open Commission", "As admin / arun open /commission", "Redirected to dashboard (denied)", A, "auth"),
    ("AUTH-25", "AUTH", "CL-25", R, "P2", "User can't deactivate / delete a product", "As Arun open Renewals", "No 'Deactivate / delete' button", A, "auth"),
    ("AUTH-26", "AUTH", "CL-26", R, "P1", "Commission hidden from menu, opens by URL for Super Admin", "As superadmin check menu; open /commission", "No 'Commission' menu item; page opens", A, "auth"),
    ("AUTH-27", "AUTH", "CL-39", R, "P1", "P&L only for Super Admin", "As admin open /pnl; as superadmin open /pnl", "Admin denied; Super Admin sees Profit & Loss", A, "auth"),
    ("AUTH-28", "AUTH", "Brief", R, "P1", "Direct URL to Settings → Users as User", "As Arun open /settings/users", "Redirected to dashboard (denied)", A, "auth"),
    ("AUTH-29", "AUTH", "CL-10", R, "P2", "Leads stay own-only for Users", "As Arun open Leads", "Only leads owned by Arun", A, "auth"),
    ("AUTH-30", "AUTH", "CL-30", H, "P2", "Super Admin adds a Super Admin login", "Settings → Users → Add a login with role Super Admin", "New login listed with role Super Admin; it can sign in", A, "auth"),
    ("AUTH-31", "AUTH", "CL-30", N, "P2", "Password shorter than 8 refused", "Add a login with a 7-character password", "Error; no user created", A, "auth"),
    # ── CUST ────────────────────────────────────────────────────────────────────────────────────────────────
    ("CUST-01", "CUST", "Brief", H, "P1", "Customer list shows all customers", "Open Partners / Customers as Super Admin", "Row count equals DB customer count", A, "customers"),
    ("CUST-02", "CUST", "Brief", H, "P1", "Search by name and by mobile", "Search a name; then the last digits of a mobile", "Only matching customers", A, "customers"),
    ("CUST-03", "CUST", "Brief", H, "P2", "Filter by product", "Product = Post office", "Every row holds a post office scheme; count equals DB", A, "customers"),
    ("CUST-04", "CUST", "Brief", N, "P3", "Search with no match", "Search 'zzzz-no-such'", "Empty list message, no error", A, "customers"),
    ("CUST-05", "CUST", "Brief", H, "P1", "Edit customer details and change log", "Edit details: email, address; Save changes; confirm", "Saved; AuditLog row with old/new values", A, "customers"),
    ("CUST-06", "CUST", "VAL", N, "P1", "Edit with invalid mobile", "Mobile '12345'", "Error '10-digit'; not saved", A, "customers"),
    ("CUST-10", "CUST", "CL-03", N, "P1", "Aadhaar / PAN need the consent tick", "Add Aadhaar / PAN without ticking consent", "Refused", A, "customers"),
    ("CUST-11", "CUST", "CL-03, CL-08", N, "P1", "Duplicate PAN shows the existing customer", "Enter a PAN that belongs to another customer", "Duplicate pop-up names the other customer; not saved", A, "customers"),
    ("CUST-12", "CUST", "CL-03", H, "P2", "Unique PAN saves masked", "Enter a new valid PAN + consent", "Saved; only masked PAN shown", A, "customers"),
    ("CUST-13", "CUST", "CL-08", N, "P2", "Duplicate Aadhaar refused", "Enter Aadhaar of another customer", "Duplicate pop-up; not saved", A, "customers"),
    ("CUST-20", "CUST", "CL-07", H, "P3", "Add product has Save at top and bottom", "Open Add product directly", "Two 'Save product' buttons", A, "customers"),
    ("CUST-21", "CUST", "CL-07, NR-03", H, "P3", "Edit customer pop-up has one Save", "Open Edit details", "Exactly one 'Save changes' button", A, "customers"),
    ("CUST-25", "CUST", "Brief", H, "P1", "Add a product directly creates holding and bills", "Add product directly: Post Office RD, monthly, amount, start date, account no.", "Holding listed; RenewalItems created with IP- numbers", A, "customers"),
    ("CUST-30", "CUST", "Brief", N, "P2", "Customer with records can't be deleted", "Actions → Delete on a customer with holdings", "Delete not offered; reason shown", A, "customers"),
    ("CUST-31", "CUST", "Brief", BL, "P2", "Deactivate a customer", "—", "Not in the app (Q11)", BL, "customers"),
    ("CUST-32", "CUST", "Brief", BL, "P3", "Family / nominee links", "—", "Family grouping deferred; nominee only on a holding (Q11)", BL, "customers"),
    # ── PROD / SET ──────────────────────────────────────────────────────────────────────────────────────────
    ("PROD-01", "PROD", "CL-14", H, "P2", "Bill rule per product is saved", "Edit a product's bill rule", "Saved and logged", A, "settings"),
    ("PROD-10", "PROD", "CL-PC", H, "P1", "New category becomes a quotation group", "Add a product with Category 'QA Motor'", "'QA Motor' appears in the quotation Product list", A, "settings"),
    ("PROD-11", "PROD", "CL-PC", B, "P2", "Blank category is set from the type", "Add an MF product with blank Category", "Saved with category 'Mutual fund'", A, "settings"),
    ("PROD-12", "PROD", "CL-PC", N, "P3", "Category over 40 characters refused", "Category of 41 characters", "Error", A, "settings"),
    ("SET-01", "SET", "CL-27", B, "P2", "Bank account without MICR saves", "Add bank account, MICR blank", "Saved", A, "settings"),
    ("SET-02", "SET", "CL-27", N, "P3", "MICR must be 9 digits when typed", "MICR '12345'", "Error", A, "settings"),
    ("SET-05", "SET", "CL-28", H, "P1", "Add own pay mode", "Settings → Payment modes → add 'QA PhonePe' working like UPI", "Listed and offered on receipts", A, "settings"),
    ("SET-06", "SET", "CL-28", H, "P2", "Switch a built-in mode off", "Switch Cheque off", "Cheque not offered on new receipts", A, "settings"),
    ("SET-07", "SET", "CL-28", H, "P2", "Delete an unused own pay mode", "Delete 'QA PhonePe'", "Removed", A, "settings"),
    ("SET-08", "SET", "CL-29", H, "P3", "No customer bank list in Payment modes", "Open Payment modes", "No 'Customer banks' section", A, "settings"),
    # ── QUOT / PROP ─────────────────────────────────────────────────────────────────────────────────────────
    ("QUOT-01", "QUOT", "CL-12", H, "P1", "Product list comes from Settings categories", "New quotation", "Product options = categories of active products", A, "quotations"),
    ("QUOT-02", "QUOT", "CL-12", H, "P1", "Company list follows the product", "Pick Post office", "Company options = 'Post Office' only", A, "quotations"),
    ("QUOT-03", "QUOT", "CL-12", H, "P1", "Plan list follows the company; pay mode follows the plan", "Post office → Post Office → Post Office RD", "Pay mode options = Monthly only; no sum insured", A, "quotations"),
    ("QUOT-04", "QUOT", "CL-12", H, "P1", "Save a two-product quotation", "Health + Life rows with premiums; Save; confirm", "Quotation page Q-… opens; total = sum", A, "quotations"),
    ("QUOT-05", "QUOT", "CL-12", N, "P2", "Missing plan refused", "Leave plan blank; Save", "Error 'Pick the plan'", A, "quotations"),
    ("QUOT-10", "QUOT", "CL-35", H, "P1", "Quotation tabs and Mark as sent", "Open new quotation; Mark as sent; check tabs", "Moves from Drafts to Sent", A, "quotations"),
    ("QUOT-11", "QUOT", "CL-35", H, "P2", "Converted tab after proposal", "Create proposal from selected", "Quotation in Converted", A, "quotations"),
    ("QUOT-20", "QUOT", "CL-13", BL, "P2", "GST rates from Settings", "—", "Not implemented (Q5)", BL, "quotations"),
    ("PROP-05", "PROP", "CL-23", H, "P1", "Issued proposal leaves the list", "Issue a proposal with a policy number", "Not in Proposals list; 'Show issued proposals' lists it; customer has the holding", A, "journeys"),
    ("PROP-07", "PROP", "NR-04", H, "P2", "Post office proposal says Account number", "Open a post office proposal", "Label 'Account number (leave blank until issued)'", A, "quotations"),
    # ── REN ─────────────────────────────────────────────────────────────────────────────────────────────────
    ("REN-01", "REN", "CL-19", H, "P2", "View dropdown options", "Open Renewals → View", "Today, This week, This month, Next 30 days, Next 3 months, Last month, Custom dates", A, "renewals"),
    ("REN-02", "REN", "CL-19", B, "P2", "Custom date range", "From/To one day", "Only bills due that day", A, "renewals"),
    ("REN-03", "REN", "CL-19", H, "P2", "Custom dates shows From / To and stays selected", "Pick Custom dates; fill dates; Show renewals; then pick This month", "From / To boxes appear only for Custom dates; the dropdown does not snap back; no duplicate option", A, "renewals"),
    ("REN-05", "REN", "CL-20", H, "P1", "Maturity tab separate", "Open Maturity tab", "Maturity rows only; none of them on Due", A, "renewals"),
    ("REN-10", "REN", "CL-24", H, "P1", "Send reminder is logged", "Send reminder on a Due row", "Reminders sent +1; MessageLog row 'Sent (mock)'", A, "renewals"),
    ("REN-11", "REN", "CL-24", H, "P2", "Reminder history", "Click the reminders count", "History lists date, channel, who", A, "renewals"),
    ("REN-12", "REN", "CL-25", H, "P1", "Deactivate a product", "Deactivate / delete → Deactivate with reason", "Policy Deactivated; unpaid bills Stopped", A, "renewals"),
    ("REN-13", "REN", "CL-25", N, "P2", "Deactivate needs a reason", "Deactivate with blank reason", "Refused", A, "renewals"),
    ("REN-14", "REN", "CL-25", R, "P2", "Delete only for Super Admin", "Admin opens Deactivate / delete", "No Delete option for Admin", A, "renewals"),
    ("REN-20", "REN", "CL-17", H, "P2", "Download only current tab", "Open Download", "Only Excel / PDF of this tab", A, "renewals"),
    ("REN-21", "REN", "CL-18, NR-02", H, "P1", "Renewals Excel format", "Download Due Excel", "9 columns as spec; dates 'dd mmm yyyy'; amount '₹#,##0'; rows = screen rows", A, "renewals"),
    ("REN-22", "REN", "CL-18", H, "P3", "Paid tab Excel columns", "Download Paid Excel", "Documents current columns (Q6)", A, "renewals"),
    ("REN-25", "REN", "CL-38", H, "P2", "New bills numbered IP-", "After adding a product", "Bill numbers match IP-\\d{2,}", A, "customers"),
    # ── RCPT ────────────────────────────────────────────────────────────────────────────────────────────────
    ("RCPT-01", "RCPT", "CL-05, CL-37", H, "P1", "Cash receipt for one due", "New receipt; cash; notes = amount; Save", "Receipt AA-nn; bill Paid; Day Book entry", A, "receipts"),
    ("RCPT-02", "RCPT", "CL-05", N, "P1", "UPI needs a reference", "Mode UPI, no reference", "Refused", A, "receipts"),
    ("RCPT-06", "RCPT", "CL-06", N, "P1", "Cash notes must add up", "Notes total ≠ amount", "Refused", A, "receipts"),
    ("RCPT-07", "RCPT", "CL-47", B, "P1", "Change given back", "Received more, change entered so kept = amount", "Saved; change printed", A, "receipts"),
    ("RCPT-10", "RCPT", "CL-21", H, "P3", "No Bill column in bills table", "Open New receipt for a customer", "No 'Bill' column header", A, "receipts"),
    ("RCPT-21", "RCPT", "CL-44", N, "P1", "Cancelled number never reused", "Cancel the receipt; make another", "New number is higher; no duplicates in DB", A, "receipts"),
    ("RCPT-25", "RCPT", "CL-45", H, "P1", "Combined receipt is one AA receipt", "Combined receipt for 2 bills", "One Payment AA-nn, lines AA-nn/1, /2; no PAY- document", A, "receipts"),
    # ── DB / EXP / ESV ──────────────────────────────────────────────────────────────────────────────────────
    ("DB-01", "DB", "CL-06", N, "P2", "ATM withdrawal needs notes", "ATM form with notes ≠ amount", "Record button stays disabled / refused", A, "daybook"),
    ("DB-05", "DB", "CL-32", H, "P2", "Other income in cash asks for notes", "Other income, mode Cash", "Denomination grid shown", A, "daybook"),
    ("DB-10", "DB", "CL-22", H, "P1", "Cash / UPI exchange", "Cash given · UPI received; amount, account, txn, person, notes", "One Day Book row; not income or expense", A, "daybook"),
    ("DB-11", "DB", "CL-22", N, "P2", "Exchange needs UPI transaction no.", "Leave UPI txn blank", "Refused", A, "daybook"),
    ("DB-15", "DB", "CL-43", H, "P3", "ATM 'Withdrawn by' defaults to me", "Open Day Book as Arun", "'Withdrawn by' = Arun", A, "daybook"),
    ("EXP-01", "EXP", "CL-42", N, "P1", "UPI expense needs transaction ID", "Mode UPI, no transaction ID", "Refused", A, "expenses"),
    ("EXP-02", "EXP", "CL-42", H, "P2", "Cash hides transaction ID", "Mode Cash", "No transaction ID box", A, "expenses"),
    ("EXP-03", "EXP", "CL-42", B, "P2", "Bill number optional", "Save without bill no.", "Saved", A, "expenses"),
    ("EXP-04", "EXP", "CL-42", N, "P1", "Same vendor bill no. twice", "Repeat vendor + bill no.", "Pop-up names the earlier expense; not saved", A, "expenses"),
    ("EXP-05", "EXP", "CL-42", H, "P3", "Help text matches the rule", "Open Expenses", "No 'Bill number is required' text (bill no. is optional)", A, "expenses"),
    ("ESV-10", "ESV", "CL-15", H, "P3", "Module named Esevai & CSC", "Menu and page title", "'Esevai & CSC'", A, "esevai"),
    ("ESV-11", "ESV", "CL-16", H, "P3", "Entry button is Save", "Open Esevai & CSC", "Button 'Save'; no 'Print receipt'", A, "esevai"),
    ("ESV-12", "ESV", "NR-01, CL-01", H, "P3", "No UTR or Notes box", "Open the entry form", "No UTR / Notes fields", A, "esevai"),
    ("ESV-20", "ESV", "CL-46", H, "P2", "Rates page lists EB slabs and PAN / certificate", "Settings → Esevai & CSC rates", "Rates with start dates", A, "esevai"),
    ("ESV-22", "ESV", "CL-46, CL-01", B, "P2", "EB bill outside slabs", "EB bill ₹1,500", "No charge pre-filled; saves with the typed charge (Q9: slab still undefined)", A, "esevai"),
    # ── FUP / MSG / TKT ─────────────────────────────────────────────────────────────────────────────────────
    ("LEAD-05", "LEAD", "CL-36", H, "P1", "New lead numbered RR-nn", "Add a lead", "leadNo matches RR-\d{2,}", A, "validation"),
    ("FUP-01", "FUP", "Brief", H, "P1", "Overdue call shows on Follow-ups", "Open Follow-ups as Arun", "Overdue call listed with 'Overdue'", A, "followups"),
    ("FUP-02", "FUP", "Brief", H, "P1", "Schedule a call for today", "Schedule call for a lead today", "Listed as due today", A, "followups"),
    ("FUP-03", "FUP", "Brief", H, "P1", "Complete a call", "Open reminder; outcome Interested; Save", "Call closed; leaves open list", A, "followups"),
    ("FUP-04", "FUP", "Brief", N, "P2", "No answer needs a new time", "Outcome No answer without date", "Refused", A, "followups"),
    ("FUP-05", "FUP", "Brief", BL, "P2", "Reassign a follow-up to another employee", "—", "Not in the app (Q12)", BL, "followups"),
    ("MSG-01", "MSG", "CL-24", H, "P1", "Sent messages lists reminders with customer data", "After REN-10 open Sent messages", "Row with channel, masked number, text containing customer name and amount", A, "renewals"),
    ("MSG-02", "MSG", "Brief", BL, "P2", "Provider failure and retry", "—", "Mock provider only, no failure/retry (Q13)", BL, "renewals"),
    ("TKT-01", "TKT", "NR-12", H, "P1", "User raises a ticket", "Arun raises High problem", "TK- number; status Open; target 3 days", A, "journeys"),
    ("TKT-02", "TKT", "NR-12", N, "P2", "Ticket needs title and details", "Submit empty", "Refused", A, "tickets"),
    ("TKT-03", "TKT", "NR-12", H, "P1", "Admin changes status; raiser sees it", "Admin sets In progress + comment", "Arun sees new status and comment", A, "journeys"),
    ("TKT-04", "TKT", "NR-12", R, "P2", "User sees only own tickets", "Divya opens Tickets", "Arun's ticket not listed", A, "tickets"),
    ("TKT-05", "TKT", "NR-12", H, "P2", "High ticket alert is logged", "After TKT-01", "MessageLog ticketAlert row", A, "journeys"),
    # ── RPT / DASH ──────────────────────────────────────────────────────────────────────────────────────────
    ("RPT-05", "RPT", "CL-33", H, "P2", "One-customer download has no owner-paid slips", "Download a customer's Excel", "No 'Owner-paid' sheet", A, "reports"),
    ("RPT-06", "RPT", "CL-34", H, "P1", "Customer list Excel = all customers, all columns", "Download customers Excel", "Rows = DB count; columns include email, address, PAN, Aadhaar, consent, staff", A, "reports"),
    ("RPT-07", "RPT", "Brief", H, "P1", "Receipts Excel matches screen", "Download receipts Excel", "Receipt numbers equal those on screen", A, "reports"),
    ("RPT-08", "RPT", "Brief", R, "P1", "Users can't download", "As Arun GET /api/export/customers", "403", A, "reports"),
    ("DASH-01", "DASH", "Brief", H, "P1", "Dashboard 'Collected' equals DB", "Open dashboard", "Collected this month = sum of saved receipts this month", A, "reports"),
    ("DASH-02", "DASH", "Brief", H, "P2", "Renewals due this week equals DB", "Open dashboard", "Row count = DB count", A, "reports"),
    # ── VAL ─────────────────────────────────────────────────────────────────────────────────────────────────
    ("VAL-01", "VAL", "Brief", N, "P1", "Lead mobile must be 10 digits", "Add lead with 9 and 11 digits", "Refused", A, "validation"),
    ("VAL-02", "VAL", "Brief", N, "P2", "Mobile must start 6-9", "Mobile 5123456789", "Refused", A, "validation"),
    ("VAL-03", "VAL", "Brief", N, "P1", "PAN format AAAAA9999A", "PAN 'ABCD1234E'", "Refused", A, "customers"),
    ("VAL-04", "VAL", "Brief", N, "P1", "Aadhaar 12 digits", "Aadhaar 11 digits", "Refused", A, "customers"),
    ("VAL-05", "VAL", "Brief", BL, "P3", "PIN code 6 digits", "—", "No PIN field (Q15)", BL, "validation"),
    ("VAL-06", "VAL", "Brief", H, "P2", "Dates shown dd/mm/yyyy", "Leads / customers / receipts lists", "Dates match dd/mm/yyyy", A, "validation"),
    ("VAL-07", "VAL", "Brief", N, "P2", "Impossible date refused", "Renewals From = 31/02/2026", "Not accepted", A, "validation"),
    ("VAL-08", "VAL", "Brief", H, "P2", "Rupees use lakh grouping", "Dashboard amounts ≥ 1 lakh", "Format ₹1,27,520 (not 127,520)", A, "validation"),
    # ── Cross-cutting ───────────────────────────────────────────────────────────────────────────────────────
    ("J1", "JRN", "Brief", J, "P1", "Lead → quotation → proposal → policy → reminder → receipt → reports", "See journeys/j1", "Every step persists; reminder logged; bill Paid; dashboard & receipts export include it", A, "journeys"),
    ("J2", "JRN", "Brief", J, "P1", "Ticket raised → admin updates → user sees", "See journeys/j2", "Status and comment visible to raiser", A, "journeys"),
    ("J3", "JRN", "Brief", J, "P2", "Customer → scheme advisor → suggestion saved", "—", "No scheme advisor (Q14)", BL, "journeys"),
    ("ADV-01", "ADV", "Brief", BL, "P2", "Scheme advisor rule table", "—", "Not in the app (Q14)", BL, "journeys"),
    ("CONC-01", "CONC", "Brief", C, "P1", "Two users edit the same customer", "Admin opens Edit details; Arun opens the same customer; Admin saves; Arun reopens and saves", "Arun is told Admin is editing and cannot save; after Admin saves, Arun's later save keeps Admin's change", A, "concurrency"),
    ("CONC-05", "CONC", "Brief", C, "P2", "Leaving the page frees the editing ticket", "Open Edit details, then go to another page without Cancel or Save", "The ticket is released at once (not after 5 minutes)", A, "concurrency"),
    ("CONC-04", "CONC", "Brief", C, "P1", "Expired editing ticket + stale form", "Arun opens Edit; ticket expires; Admin opens and saves; Arun saves his old form", "Arun's save is refused ('was just changed by'); Admin's change kept", A, "concurrency"),
    ("CONC-02", "CONC", "CL-44", C, "P1", "Two receipts for the same bill at once", "Two users submit receipt for the same due", "Exactly one succeeds; bill paid once", A, "concurrency"),
    ("CONC-03", "CONC", "CL-36, CL-44", C, "P1", "Numbers unique under parallel saves", "4 leads created in parallel", "All RR numbers distinct", A, "concurrency"),
    ("PERF-01", "PERF", "Brief", P, "P1", "Customers list with 2,000 customers", "Volume seed; open /customers", "< 3 s", A, "volume"),
    ("PERF-02", "PERF", "Brief", P, "P1", "Customer search at volume", "Search a name", "< 3 s", A, "volume"),
    ("PERF-03", "PERF", "Brief", P, "P1", "Renewals at volume", "Open /renewals (next 30 days)", "< 3 s", A, "volume"),
    ("PERF-04", "PERF", "Brief", P, "P1", "Receipts at volume", "Open /receipts", "< 3 s", A, "volume"),
    ("PERF-05", "PERF", "Brief", P, "P2", "Dashboard at volume", "Open /dashboard", "< 3 s", A, "volume"),
    ("PERF-06", "PERF", "Brief", P, "P2", "Customers Excel at volume", "GET /api/export/customers", "< 3 s; 2,000+ rows", A, "volume"),
    ("INT-01", "INT", "Brief", I, "P1", "No orphan rows", "SQL checks after journeys", "0 orphans (bills, receipts, lines, policies, calls)", A, "integrity"),
    ("INT-02", "INT", "Brief", I, "P1", "Foreign keys enforced in the DB", "Query information_schema", "FK constraints exist on child tables", A, "integrity"),
    ("INT-03", "INT", "Brief", I, "P1", "Audit fields populated", "createdById / ownerId on journey rows; a change-log entry for each record created", "Filled; every created lead, quotation, proposal, policy, receipt has a change-log row", A, "integrity"),
    ("INT-04", "INT", "Brief", I, "P1", "Numbers unique", "SQL duplicates on receiptNo, billNo, leadNo, paymentNo", "0 duplicates", A, "integrity"),
    ("INT-06", "INT", "Brief", I, "P2", "User references are foreign keys", "information_schema on ownerId / createdById / raisedById / AuditLog.userId", "FK constraints to User exist", A, "integrity"),
    ("INT-05", "INT", "Brief", I, "P2", "Day Book balances", "Sum of in − out per entry source", "Each receipt has exactly one Day Book line", A, "integrity"),
    ("SEC-01", "SEC", "Brief", S, "P1", "XSS strings stored as text", "Lead name / ticket title '<script>…', '<img onerror>'", "Shown literally; no dialog runs", A, "security"),
    ("SEC-02", "SEC", "Brief", S, "P1", "SQL injection in search / filters", "\"' OR 1=1 --\" in search boxes", "No error; no extra rows", A, "security"),
    ("SEC-03", "SEC", "Brief", S, "P1", "APIs without a session", "GET exports, PDFs, attachment, photo with no cookie", "No data (redirect to login / 401 / 403)", A, "security"),
    ("SEC-04", "SEC", "Brief", S, "P1", "User calls admin-only exports", "As Arun GET /api/export/pnl, /commission", "403", A, "security"),
    ("SEC-05", "SEC", "Brief", S, "P2", "User calls Super-Admin pages", "As Arun open /settings/roles, /pnl, /commission", "Denied", A, "security"),
    ("SEC-06", "SEC", "Brief", S, "P2", "Unknown report name", "GET /api/export/xyz", "404", A, "security"),
    ("XBR-01", "XBR", "Brief", X, "P2", "Chrome 1366x768 smoke", "Login, dashboard, customers, quotation, receipts", "Pages render; no horizontal page overflow", A, "browser"),
    ("XBR-02", "XBR", "Brief", X, "P2", "Chrome 1920x1080 smoke", "Same", "Same", A, "browser"),
    ("XBR-03", "XBR", "Brief", X, "P2", "Edge 1366x768 smoke", "Same", "Same", A, "browser"),
    ("XBR-04", "XBR", "Brief", X, "P2", "Edge 1920x1080 smoke", "Same", "Same", A, "browser"),
    ("A11Y-01", "A11Y", "Brief", N, "P3", "Form fields have labels", "Raise ticket and Add expense forms", "Every field has an accessible name", A, "validation"),
]

# Removed-sheet regressions (already in the app) – covered by the existing Vitest suite, re-run as part of QA.
# (The Removed sheet has no item 8, so RG-08.. map to RM-09..)
for rid, rm, title in [("RG-01", "RM-01", "Consent tick before Aadhaar/PAN"), ("RG-02", "RM-02", "KYC optional"), ("RG-03", "RM-03", "Bank account on non-cash receipts"),
                       ("RG-04", "RM-04", "Advance payment one receipt"), ("RG-05", "RM-05", "Multiple dues one receipt"), ("RG-06", "RM-06", "Combined postal receipt"),
                       ("RG-07", "RM-07", "Wallets balance/recharge/statement"), ("RG-08", "RM-09", "Expense types & from-account"), ("RG-09", "RM-10", "ATM withdrawal"),
                       ("RG-10", "RM-11", "3-day grace period"), ("RG-11", "RM-12", "MICR & account type")]:
    CASES.append((rid, "REG", rm, "Regression", "P2", title, "pnpm test (Vitest, scratch DB)", "Existing unit tests pass", A, "vitest"))

FIELDS = ["id", "module", "requirements", "type", "priority", "title", "steps", "expected", "automation", "spec"]
rows = [dict(zip(FIELDS, c)) for c in CASES]
assert len({r["id"] for r in rows}) == len(rows), "duplicate test IDs"
here = Path(__file__).parent
(here / "test-cases.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__":
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    wb = Workbook(); ws = wb.active; ws.title = "Test cases"
    ws.append([f.replace("_", " ").title() for f in FIELDS])
    for r in rows:
        ws.append([r[f] for f in FIELDS])
    for i, w in enumerate([9, 7, 14, 12, 8, 42, 50, 50, 11, 12], 1):
        ws.column_dimensions[chr(64 + i)].width = w
    for c in ws[1]:
        c.font = Font(name="Arial", bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F3864")
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = Font(name="Arial", size=10); c.alignment = Alignment(wrap_text=True, vertical="top")
        if row[8].value == BL:
            row[8].fill = PatternFill("solid", fgColor="FCE4D6")
    ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
    s = wb.create_sheet("Summary")
    from collections import Counter
    s.append(["By automation", ""]); [s.append([k, v]) for k, v in Counter(r["automation"] for r in rows).items()]
    s.append([]); s.append(["By module", ""]); [s.append([k, v]) for k, v in sorted(Counter(r["module"] for r in rows).items())]
    s.append([]); s.append(["Total", len(rows)])
    s.column_dimensions["A"].width = 18
    out = Path("D:/Projects/GRM/QA/GRM_QA_Phase2_Test_Design.xlsx"); wb.save(out)
    print(len(rows), "cases →", out, dict(Counter(r["automation"] for r in rows)))
