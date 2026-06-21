# Three-Way Match Engine

A backend service that parses PO, GRN, and Invoice documents using Google Gemini, stores them in MongoDB, and computes three-way match results at the item level.

---

## Quick Start

```bash
git clone <repo-url>
cd three-way-match
npm install
cp .env.example .env   # fill in MONGO_URI and GEMINI_API_KEY
npm run dev
```

### Environment Variables

```bash
MONGO_URI=mongodb://localhost:27017/three-way-match
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
NODE_ENV=development
```

---

## API

### Upload a document
```
POST /api/documents/upload
Content-Type: multipart/form-data

Fields:
  file          — PDF or image file
  documentType  — "po" | "grn" | "invoice"
```

```bash
curl -X POST http://localhost:3000/api/documents/upload \
  -F "file=@po.pdf" \
  -F "documentType=po"
```

**Response:**
```json
{
  "success": true,
  "documentId": "uuid-here",
  "documentType": "po",
  "poNumber": "CI4PO05788",
  "parsedData": { "...": "..." },
  "matchStatus": "insufficient_documents",
  "matchReasons": ["Missing documents: GRN, Invoice"]
}
```

### Get a parsed document
```
GET /api/documents/:documentId
```

### Get three-way match result
```
GET /api/match/:poNumber
```

**Response:**
```json
{
  "success": true,
  "poNumber": "CI4PO05788",
  "status": "partially_matched",
  "reasons": ["invoice_date_after_po_date", "item_missing_in_po"],
  "linkedDocuments": {
    "poId": "uuid",
    "grnIds": ["uuid"],
    "invoiceIds": ["uuid"]
  },
  "itemDetails": [
    {
      "itemCode": "11423",
      "description": "Spicy Veg Momos 24 Pieces",
      "poQty": 50,
      "totalGrnQty": 50,
      "totalInvoiceQty": 50,
      "issues": [],
      "status": "ok"
    }
  ],
  "lastUpdated": "2026-03-24T12:34:56.000Z"
}
```

---

## Approach

1. **Gemini-powered parsing** — PDFs are sent as base64 to Gemini with strict structured prompts. The response is cleaned (strip markdown fences if present) and JSON-parsed.
2. **DTO normalization** — LLM output is non-deterministic. A normalization layer (`normalize.js`) enforces correct types, handles field name aliases across document formats, and throws descriptive errors on missing required fields before anything touches the database.
3. **Unified document storage** — All three document types live in one MongoDB collection with a `type` discriminator. Querying all documents for a PO is a single `.find({ poNumber })` — no joins, no cross-collection queries.
4. **Pure match engine** — `matchEngine.js` is a pure function: receives `{ po, grns, invoices }` as plain objects, returns `{ status, reasons, itemDetails }` with zero DB calls. Testable without any mocking.
5. **State-based matching** — Match is computed synchronously after every upload and on every `GET /match/:poNumber` request. The system always queries current state, so document upload order never matters.

---

## Data Model

### `Document` collection (unified)

All PO, GRN, and Invoice records share one collection, discriminated by `type`.

```js
{
  documentId: String,      // UUID — stable external reference
  type: 'po' | 'grn' | 'invoice',
  poNumber: String,        // shared linking key across all types
  data: Mixed,             // normalized payload, shape varies by type
  rawFilePath: String,
  uploadedAt: Date
}
// Indexes: documentId (unique), poNumber, { poNumber + type }
```

**PO `data` shape:**
```js
{
  poNumber, poDate, vendorName, vendorGstin, buyerName,
  items: [{ itemCode, description, quantity, unitPrice, hsnCode }]
}
```

**GRN `data` shape:**
```js
{
  grnNumber, poNumber, grnDate, invoiceNumber, vendorName,
  items: [{ itemCode, description, expectedQuantity, receivedQuantity, unitPrice }]
}
```

**Invoice `data` shape:**
```js
{
  invoiceNumber, poNumber, invoiceDate, vendorName, buyerName, totalAmount,
  items: [{ itemCode, description, quantity, unitPrice, taxableValue }]
}
```

### `MatchResult` collection

One document per `poNumber`. Upserted on every upload and every `GET /match` request.

```js
{
  poNumber: String,
  status: 'matched' | 'partially_matched' | 'mismatch' | 'insufficient_documents',
  reasons: [String],
  linkedDocuments: { poId, grnIds, invoiceIds },
  itemDetails: [{
    itemCode, description,
    poQty, totalGrnQty, totalInvoiceQty,
    issues: [String],
    status: 'ok' | 'warning' | 'mismatch'
  }],
  lastUpdated: Date
}
```

---

## Parsing Flow

```
POST /api/documents/upload
  1. multer saves file to uploads/ directory
  2. geminiParser sends file as base64 to Gemini (gemini-2.5-flash)
  3. Response stripped of markdown fences and JSON.parsed
  4. normalize.js enforces types and required fields — throws on missing poNumber
  5. Document saved to MongoDB with a UUID documentId
  6. computeAndSaveMatch(poNumber) runs synchronously
  7. Upload response returns the fresh match status for that PO

GET /api/match/:poNumber
  Calls computeAndSaveMatch(poNumber) independently — always fresh,
  regardless of upload history or order.
```

---

## Matching Logic

**Item matching key:** `itemCode` (SKU/item code from each document).

Chosen because it is unambiguous — two items with the same name but different sizes carry different codes. A description-based fallback handles the real-world case where vendor invoices use internal `FG-*` codes while the buyer's PO and GRN use numeric SKU codes. See Assumptions for the known limitation of this fallback.

**Quantity aggregation:** Multiple GRNs and multiple Invoices per PO are fully supported. Quantities are summed per item across all documents of each type before any comparison.

**Item-level rules:**

| Rule | Reason code | Item status |
|------|-------------|--------|
| GRN received qty > PO qty | `grn_qty_exceeds_po_qty` | mismatch |
| Invoice qty > PO qty | `invoice_qty_exceeds_po_qty` | mismatch |
| Invoice qty > total GRN qty | `invoice_qty_exceeds_grn_qty` | warning |
| GRN item not found in PO | `item_missing_in_po` | mismatch |


**Document-level rules:**

| Rule | Reason code |
|------|-------------|
| Invoice date is after PO date | `invoice_date_after_po_date` |
| More than one PO for same poNumber | `duplicate_po` |
| PO, GRN, or Invoice missing | `insufficient_documents` |

**Overall status:**
- `matched` — no issues on any item
- `partially_matched` — at least one item OK, at least one with issues
- `mismatch` — every item has a critical violation
- `insufficient_documents` — PO, GRN, or Invoice not yet uploaded

---

## Out-of-Order Uploads

Documents are stored independently. The match engine queries all three document types on every call — there is no dependency on upload order.

```
Upload Invoice → stored; match runs → insufficient_documents (no PO or GRN yet)
Upload GRN     → stored; match runs → insufficient_documents (no PO yet)
Upload PO      → stored; match runs → partially_matched / matched / mismatch
```

`GET /match/:poNumber` always recomputes from current state and returns the same result regardless of what triggered it.

---

## Assumptions

1. `poNumber` is present and consistent across PO, GRN, and Invoice. It is the only shared linking key — the system cannot link documents without it.
2. In the sample documents, the Invoice references the PO via the "Customer Order No." field. Gemini prompts explicitly instruct the model to extract this field as `poNumber`.
3. Item codes differ between vendor-issued documents and buyer-side documents. The Invoice uses vendor-internal `FG-*` codes while the PO and GRN use numeric SKU codes. The description-based fallback handles most cases but can produce false positives when item names share a long common prefix (e.g. "Pork Breakfast Bacon 150g" vs "Pork Breakfast Bacon 300g"). This is a known limitation.
4. Gemini may occasionally OCR numeric item codes incorrectly — for example, reading `5` as `$`, producing codes like `$98770` instead of `598770`. This causes the affected items to fall through to description matching, which may not always resolve correctly. Adding a sanitizer to strip non-alphanumeric characters from item codes would reduce this class of errors.
5. Partial deliveries are valid: GRN quantity less than PO quantity is not an error.
6. Multiple GRNs per PO represent phased deliveries. Their quantities are aggregated before comparison.
7. `invoice_date_after_po_date` is flagged as a reason per the assignment spec. In the provided sample documents, the PO date is March 17 and the Invoice date is March 24 — this flag is expected and correct for those documents.

---

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
|Unified `Document` collection | Single query per PO; no joins needed |`data` is untyped `Mixed` — no DB-level schema enforcement per type |
|Gemini Flash over Pro |Lower cost, faster response |Occasional OCR errors on dense tabular PDFs |
|Recompute match on every GET |Always fresh; no cache invalidation logic |Extra DB read per request — fine at this scale |
| Description-based fallback matching | Handles cross-system item code mismatches |False positives when item names share a common prefix |
|Synchronous match after upload |Upload response includes current match status |Adds Gemini latency to the upload request (parse + match in one call) |
|Strict normalization at ingest |Bad data rejected early with clear error messages |Rejects genuinely incomplete documents that might otherwise partially work |

---

## What I'd Improve With More Time

1. **Item code sanitization** — Strip non-alphanumeric characters from parsed item codes (`$98770` → `598770`) to reduce Gemini OCR false positives. One-line fix in `normalize.js`.

2. **Job queue for parsing (BullMQ)** — Gemini parsing adds latency to the upload response. Moving parsing to a background queue would let uploads return immediately with a `processing` status, with clients polling `GET /match/:poNumber` for results. Also enables retries on Gemini failures.

3. **Smarter description matching** — The current fallback truncates descriptions to 25 characters. Extending to 40+ characters, or extracting weight/size tokens separately as a secondary key, would significantly reduce false matches between similar item names.

4. **Stale-check on `GET /match`** — Currently recomputes every time. Comparing `MatchResult.lastUpdated` against the latest `Document.uploadedAt` for that PO would allow skipping redundant recomputes with no correctness risk.

5. **Manual field correction endpoint** — `PATCH /documents/:id/data` to correct a specific parsed field (e.g. a misread item code) and trigger a match recompute. Currently the only fix is re-uploading the full file.

---

## File Structure

```
index.js
src/
├── config/
│   └── db.js                    # MongoDB connection
├── controllers/
│   ├── uploadController.js      # POST /documents/upload
│   └── matchController.js       # GET /documents/:id, GET /match/:poNumber
├── middleware/
│   ├── upload.js                # multer disk storage config
│   └── errorHandler.js          # Global error handler
├── models/
│   ├── Document.js              # Unified collection for all doc types
│   └── MatchResult.js           # Latest match state per poNumber
├── routes/
│   └── index.js                 # Route wiring
├── services/
│   ├── aggregationService.js    # DB queries — fetch and group docs by poNumber
│   ├── documentService.js       # Orchestration: parse → normalize → store → match
│   ├── geminiParser.js          # Gemini API integration
│   └── matchEngine.js           # Pure matching logic (zero DB calls)
└── utils/
    └── normalize.js             # DTO layer — type enforcement and field aliases
```

---

## Running Tests

```bash
npm test
```

Tests cover: insufficient documents, perfect match, GRN/invoice quantity violations, date violations, multi-GRN aggregation, duplicate PO detection — all without a database or Gemini API key.

---

## Sample Outputs

See `sample-outputs/` for:
- `parsed-po.json` — example Gemini extraction result for a PO
- `parsed-grn.json` — example Gemini extraction result for a GRN
- `parsed-invoice.json` — example Gemini extraction result for an Invoice
- `match-result.json` — example `GET /api/match/:poNumber` response

---

## License

ISC
