const { runMatchLogic } = require('../src/services/matchEngine');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(` ${label} : PASS `);
    passed++;
  } else {
    console.log(` ${label} : FAIL `);
    failed++;
  }
}

// --- Test fixtures ---

const basePO = {
  documentId: 'po-001',
  type: 'po',
  poNumber: 'CI4PO05788',
  data: {
    poDate: '2026-03-30',  // PO date AFTER invoice date → valid order
    items: [
      { itemCode: '11423', description: 'Spicy Veg Momos 24 Pieces', quantity: 50, unitPrice: 220 },
      { itemCode: '11797', description: 'Meatigo Hot Wings 250g', quantity: 75, unitPrice: 126 },
      { itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', quantity: 120, unitPrice: 141 },
    ],
  },
};

const baseGRN = {
  documentId: 'grn-001',
  type: 'grn',
  poNumber: 'CI4PO0578',
  data: {
    grnDate: '2026-03-24',
    items: [
      { itemCode: '1142', description: 'Spicy Veg Mos 24 Pieces', receivedQuantity: 50 },
      { itemCode: '1179', description: 'Meatigo Hot Wgs 250g', receivedQuantity: 75 },
      { itemCode: '1800', description: 'Meatigo icken Curry Cut 450g', receivedQuantity: 30 },
    ],
  },
};

const baseInvoice = {
  documentId: 'inv-001',
  type: 'invoice',
  poNumber: 'CI4PO05788',
  data: {
    invoiceDate: '2026-03-24',  // Invoice BEFORE PO date → valid
    items: [
      { itemCode: '11423', description: 'Spicy Veg Momos 24 Pieces', quantity: 50 },
      { itemCode: '11797', description: 'Meatigo Hot Wings 250g', quantity: 75 },
      { itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', quantity: 30 },
    ],
  },
};

console.log('\nTest 1: Insufficient documents');
{
  const result = runMatchLogic({ po: null, grns: [], invoices: [], hasDuplicatePO: false });
  assert('status is insufficient_documents', result.status === 'insufficient_documents');
  assert('reasons mention PO', result.reasons[0].includes('PO'));
}

console.log('\nTest 2: Perfect match');
{
  const result = runMatchLogic({
    po: basePO,
    grns: [baseGRN],
    invoices: [baseInvoice],
    hasDuplicatePO: false,
  });
  assert('status is matched', result.status === 'matched');
  assert('no reasons', result.reasons.length === 0);
  assert('all items ok', result.itemDetails.every((i) => i.status === 'ok'));
}

console.log('\nTest 3: GRN qty exceeds PO qty');
{
  const badGRN = {
    ...baseGRN,
    data: {
      ...baseGRN.data,
      items: [
        { itemCode: '11423', description: 'Spicy Veg Momos 24 Pieces', receivedQuantity: 999 }, // WAY over
        { itemCode: '11797', description: 'Meatigo Hot Wings 250g', receivedQuantity: 75 },
        { itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', receivedQuantity: 30 },
      ],
    },
  };
  const result = runMatchLogic({ po: basePO, grns: [badGRN], invoices: [baseInvoice], hasDuplicatePO: false });
  assert('status is mismatch or partially_matched', ['mismatch', 'partially_matched'].includes(result.status));
  assert('grn_qty_exceeds_po_qty reason present', result.reasons.includes('grn_qty_exceeds_po_qty'));
}

console.log('\nTest 4: Invoice qty exceeds GRN qty');
{
  const badInvoice = {
    ...baseInvoice,
    data: {
      ...baseInvoice.data,
      items: [
        { itemCode: '11423', description: 'Spicy Veg Momos 24 Pieces', quantity: 50 },
        { itemCode: '11797', description: 'Meatigo Hot Wings 250g', quantity: 75 },
        { itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', quantity: 100 }, // 100 > GRN's 30
      ],
    },
  };
  const result = runMatchLogic({ po: basePO, grns: [baseGRN], invoices: [badInvoice], hasDuplicatePO: false });
  assert('invoice_qty_exceeds_grn_qty reason present', result.reasons.includes('invoice_qty_exceeds_grn_qty'));
}

console.log('\n Test 5: Invoice date after PO date');
{
  const futureInvoice = {
    ...baseInvoice,
    data: { ...baseInvoice.data, invoiceDate: '2027-01-01' },
  };
  const result = runMatchLogic({ po: basePO, grns: [baseGRN], invoices: [futureInvoice], hasDuplicatePO: false });
  assert('invoice_date_after_po_date reason present', result.reasons.includes('invoice_date_after_po_date'));
}

console.log('\nTest 6: Multiple GRNs aggregate quantities');
{
  const grn1 = {
    ...baseGRN,
    documentId: 'grn-001',
    data: {
      ...baseGRN.data,
      items: [
        { itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', receivedQuantity: 60 },
      ],
    },
  };
  const grn2 = {
    ...baseGRN,
    documentId: 'grn-002',
    data: {
      ...baseGRN.data,
      items: [
        { itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', receivedQuantity: 60 },
      ],
    },
  };
  // PO has qty 120 for 18003, two GRNs deliver 60+60 = 120 total → should match
  const singleItemPO = {
    ...basePO,
    data: {
      poDate: '2026-03-30',  // After invoice date → valid
      items: [{ itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', quantity: 120 }],
    },
  };
  const singleItemInvoice = {
    ...baseInvoice,
    data: {
      invoiceDate: '2026-03-24',  // Before PO date → valid
      items: [{ itemCode: '18003', description: 'Meatigo Chicken Curry Cut 450g', quantity: 120 }],
    },
  };
  const result = runMatchLogic({ po: singleItemPO, grns: [grn1, grn2], invoices: [singleItemInvoice], hasDuplicatePO: false });
  assert('Multiple GRNs aggregate to match PO qty', result.status === 'matched');
}

console.log('\nTest 7: Duplicate PO detection');
{
  const result = runMatchLogic({ po: basePO, grns: [baseGRN], invoices: [baseInvoice], hasDuplicatePO: true });
  assert('duplicate_po reason present', result.reasons.includes('duplicate_po'));
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed!\n');
} else {
  console.log('Some tests failed.\n');
  process.exit(1);
}