# 🦀 Crab Box Register (Crab Farm Register)

A responsive, mobile-friendly web application for vertical crab farming in India. Built for any browser on phone and desktop with zero app install required.

## Key Features & Architecture

- **Tabs (strictly in order)**:
  1. **Inventory**: Record deliveries from sellers (batch number, weight, buying price, sex), live weighing totals, and move crabs into numbered boxes.
  2. **Boxes**: Rack grid of numbered boxes (1 to 500, default 40), live status chips (Growing, Moulting, Harvest, Dead, Empty), slide-in box sheet with growth logs, daily weight gain, moult tracking, move crab to another box, and notes. (Page opens on Boxes by default).
  3. **Harvest**: Log sales lots, link boxes in Harvest status (selecting crab size auto-selects boxes), automatic weight calculation, document attachments (bills/receipts up to 20 MB), and automatic snapshotting & box clearing.
  4. **Monitor**: Water temperature (°C) and pH readings from manual entry, CSV logger import, and REST API for IoT sensors; interactive SVG line charts with green safe bands and tab alert dot.
- **Header**: Farm name, sync status pill (`Synced`, `Connecting`, `This device only`), user role badge (`👤 Farm Owner (owner)`), and Settings modal.
- **Indian Farm Localization**:
  - Currency in Indian Rupees (₹) with Indian digit grouping (`₹1,44,008`).
  - Weights stored in grams, entered and displayed in kg (3 decimals, e.g. `0.085 kg`).
  - Dates displayed like `23 Nov 2026`.
- **Profit by Batch Number**:
  - Automatically calculates each crab's share of the harvest revenue proportional to its final weight:
    $$\text{selling\_price} = \text{revenue} \times \frac{\text{crab's final weight}}{\text{lot's total final weight}}$$
    $$\text{profit} = \text{selling\_price} - \text{buying\_price}$$
- **Zero Carapace Fields**: Strict adherence to domain model without any carapace fields.
- **Dual Database Architecture**:
  - Ready for **MySQL 8** (with exact `schema.sql` tables, InnoDB, utf8mb4, and window function support).
  - Out-of-the-box **Embedded ACID JSON Storage Engine** (`./data/crab_register.json`) with auto-fallback, so the app runs immediately without manual MySQL setup.

---

## Getting Started

### 1. Install & Start
```bash
npm install
npm start
```

The application runs on `http://localhost:3000`.

### 2. Default Login Accounts
- **Farm Owner (Owner role)**: `admin@crabfarm.in` / `admin123`
- **Farm Staff (Staff role)**: `staff@crabfarm.in` / `staff123`

You can click on the user pill in the top header to quickly switch between accounts.

### 3. MySQL 8 Setup (Optional)
If you have MySQL 8 running:
1. Create a `.env` file or update existing `.env`:
   ```env
   PORT=3000
   DB_TYPE=mysql
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=crab_register
   ```
2. Run `npm start`. The server will automatically connect to MySQL and execute `schema.sql` migrations.

---

## Automated Acceptance Test Suite

Run the full end-to-end acceptance suite:
```bash
npm test
```

Verifies:
- All 15 acceptance criteria from the specification
- Batch numbers uniqueness & refusal of duplicates
- Box Harvest crab size enforcement
- Moving between boxes
- Revenue and profit calculations per batch number
- Absence of carapace fields in all CSV exports
