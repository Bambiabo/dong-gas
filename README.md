# Dong Gas

A gas station reporting application for recording meter readings, tracking cash and mobile money, reconciling shift sales, and reviewing station performance.

## What Dong Gas does

Dong Gas brings the supervisor's daily shift report and the owner's financial overview into one application. It helps a station record what was dispensed, what money was collected, and whether the shift balances.

## How it works

### 1. Open a shift

The supervisor enters their name, confirms the fuel price per litre, and checks the opening meter reading. Starting the shift saves the opening details in the device's workspace. Meter readings are entered manually; the current supervisor workflow does not require photos.

### 2. Record the closing details

At the end of the shift, the supervisor enters:

- Closing meter reading
- Cash collected
- Mobile money (MoMo) collected
- Expenses paid from shift takings

Cash means the money remaining after those expenses, excluding opening float and personal money. Enter zero when there were no collections or expenses in a category.

### 3. Reconcile the shift

The supervisor report calculates:

```text
Litres sold = Closing meter - Opening meter
Expected sales = Litres sold x Fuel price per litre
Collections = Cash + MoMo
Total accounted = Cash + MoMo + Expenses
Variance = Total accounted - Expected sales
```

A negative variance indicates a shortage; a positive variance indicates an overage. A balanced result means the reported money and expenses match the meter-based expected sales, subject to rounding.

### 4. Save and upload

Completed reports are saved on the device first. When the portal is open and internet is available, the app attempts to upload pending reports to Supabase. A locally saved or pending report is not the same as a successfully uploaded report.

### 5. Export and share

The supervisor can download a PDF shift report or use the WhatsApp sharing workflow. Depending on device support, sharing may open the device share sheet or download a PDF for manual attachment.

### 6. Review owner reports

The owner unlocks the owner dashboard with their configured PIN and reviews uploaded shifts. The dashboard provides:

- Supervisor search and reporting-period filters
- Cash and MoMo totals
- Meter-based volume totals
- Opening and closing readings
- Expenses and recorded variance
- Report printing
- Station baseline settings

Photo-proof viewing has been removed from the owner dashboard.

## Offline operation and recovery

The supervisor workspace uses device-local storage to retain drafts and completed reports. Offline reopening requires the app files to be prepared while online. Pending reports can upload after connectivity returns while the portal is open.

Do not clear browser data, uninstall the app, or reset a reporting device before important reports have been backed up and their upload status checked. Keep PDF copies of important financial records.

## Cross-device status

Active-shift sharing across devices is still work in progress. The repository contains an initial shared-shift database migration, but that alone does not enable synchronization. Portal integration, database deployment, access controls, and end-to-end verification are required. Until verified, continue an ongoing shift on the original device.

## Technology stack

| Technology | Role |
| --- | --- |
| Next.js and React | Application pages and server routes |
| TypeScript | Typed application code |
| Tailwind CSS | Interface styling |
| Supabase | Database and backend services |
| IndexedDB | Device-local workspace and report storage |
| jsPDF | PDF report generation |
| Vercel | Application hosting and deployments |

## Local development

```bash
git clone https://github.com/Bambiabo/dong-gas.git
cd dong-gas
npm ci
```

Configure the required environment variables in `.env.local` using values supplied by the project administrator. Backend features require a configured Supabase project with the appropriate schema and access controls. Never commit credentials.

```bash
npm run dev
```

Open http://localhost:3000.

Available validation and production commands:

```bash
npm run lint
npm run build
npm run start
```

Listing these commands does not imply that all checks have passed.

## Project structure

```text
src/app/supervisor/   Supervisor shift workspace
src/app/owner/        Owner reporting dashboard
src/app/api/          Server API routes
src/lib/              Storage, reporting, and service utilities
supabase/migrations/  Versioned database changes
public/              Static assets and offline worker
```

## Security and deployment

Keep service-role keys, owner credentials, setup codes, and financial records private. Never expose server secrets through public client environment variables or include sensitive records in public issues.

Application deployments run through Vercel. Check deployment results and verify the supervisor and owner workflows after updates. Database migrations require their own reviewed deployment process; merging a SQL file does not confirm that the database has been updated.

## Scope

Dong Gas records supervisor-declared cash and MoMo amounts. Recording a MoMo amount is not evidence of a verified payment transaction. Financial results depend on accurate meter readings, prices, collections, and expense entries.
