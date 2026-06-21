// Normalize item code for consistent comparison
function normalizeCode(code) {
  return (code || '').toString().trim().toLowerCase();
}

// Normalize description for fallback matching
function normalizeDesc(desc) {
  return (desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .substring(0, 25);
}

// Match PO item by code, fallback to description
function findPoItem(poItems, targetCode, targetDesc) {
  // 1. Exact itemCode match
  const byCode = poItems.find(
    (i) => normalizeCode(i.itemCode) === normalizeCode(targetCode)
  );
  if (byCode) return byCode;

  // 2. Description-based fallback (handles cross-system code mismatches)
  const shortDesc = normalizeDesc(targetDesc);
  if (!shortDesc) return null;

  return poItems.find((i) => normalizeDesc(i.description).includes(shortDesc)) || null;
}

// Aggregate quantities across multiple documents
function buildQtyMap(documents, qtyField) {
  const map = {}; // { normalizedCode -> { qty, description } }

  for (const doc of documents) {
    const items = doc.data?.items || [];
    for (const item of items) {
      const key = normalizeCode(item.itemCode);
      if (!map[key]) {
        map[key] = { qty: 0, description: item.description, itemCode: item.itemCode };
      }
      map[key].qty += parseFloat(item[qtyField] || 0);
    }
  }

  return map;
}

// Pure match logic (no DB calls)
function runMatchLogic({ po, grns, invoices, hasDuplicatePO }) {
  const reasons = new Set();
  const itemDetails = [];

  // Insufficient documents check
  if (!po || grns.length === 0 || invoices.length === 0) {
    const missing = [];
    if (!po) missing.push('PO');
    if (grns.length === 0) missing.push('GRN');
    if (invoices.length === 0) missing.push('Invoice');

    return {
      status: 'insufficient_documents',
      reasons: [`Missing documents: ${missing.join(', ')}`],
      itemDetails: [],
    };
  }

  // Duplicate PO check
  if (hasDuplicatePO) {
    reasons.add('duplicate_po');
  }

  // Build quantity maps
  const grnQtyMap = buildQtyMap(grns, 'receivedQuantity');
  const invoiceQtyMap = buildQtyMap(invoices, 'quantity');

  const poDate = po.data?.poDate ? new Date(po.data.poDate) : null;

  // Invoice date validation
  for (const inv of invoices) {
    const invDate = inv.data?.invoiceDate ? new Date(inv.data.invoiceDate) : null;
    if (invDate && poDate && invDate > poDate) {
      reasons.add('invoice_date_after_po_date');
    }
  }

  // Item-level validation (iterate PO items as source of truth)
  const poItems = po.data?.items || [];

  for (const poItem of poItems) {
    const poKey = normalizeCode(poItem.itemCode);
    const poQty = parseFloat(poItem.quantity || 0);

    // Look up GRN qty for this item
    const grnEntry = grnQtyMap[poKey] ||
      // Try description fallback in grn map
      Object.values(grnQtyMap).find(
        (e) => normalizeDesc(e.description).includes(normalizeDesc(poItem.description))
      );
    const grnQty = grnEntry?.qty || 0;

    // Look up Invoice qty for this item
    const invEntry = invoiceQtyMap[poKey] ||
      Object.values(invoiceQtyMap).find(
        (e) => normalizeDesc(e.description).includes(normalizeDesc(poItem.description))
      );
    const invQty = invEntry?.qty || 0;

    const itemIssues = [];
    let itemStatus = 'ok';

    if (grnQty > poQty) {
      reasons.add('grn_qty_exceeds_po_qty');
      itemIssues.push(`GRN qty (${grnQty}) exceeds PO qty (${poQty})`);
      itemStatus = 'mismatch';
    }

    if (invQty > poQty) {
      reasons.add('invoice_qty_exceeds_po_qty');
      itemIssues.push(`Invoice qty (${invQty}) exceeds PO qty (${poQty})`);
      itemStatus = 'mismatch';
    }

    if (invQty > grnQty && grnQty > 0) {
      reasons.add('invoice_qty_exceeds_grn_qty');
      itemIssues.push(`Invoice qty (${invQty}) exceeds GRN qty (${grnQty})`);
      itemStatus = itemStatus === 'mismatch' ? 'mismatch' : 'warning';
    }

    itemDetails.push({
      itemCode: poItem.itemCode,
      description: poItem.description,
      poQty,
      totalGrnQty: grnQty,
      totalInvoiceQty: invQty,
      issues: itemIssues,
      status: itemStatus,
    });
  }

  // Check for GRN items NOT in PO (orphan items)
  for (const [code, entry] of Object.entries(grnQtyMap)) {
    const foundInPO = findPoItem(poItems, code, entry.description);
    if (!foundInPO) {
      reasons.add('item_missing_in_po');
      itemDetails.push({
        itemCode: entry.itemCode,
        description: entry.description,
        poQty: 0,
        totalGrnQty: entry.qty,
        totalInvoiceQty: 0,
        issues: ['Item received in GRN has no matching PO line'],
        status: 'mismatch',
      });
    }
  }

  // Determine overall status
  const reasonList = [...reasons];
  let status;

  if (reasonList.length === 0) {
    status = 'matched';
  } else if (
    reasonList.some((r) =>
      ['grn_qty_exceeds_po_qty', 'invoice_qty_exceeds_po_qty',
       'invoice_qty_exceeds_grn_qty', 'invoice_date_after_po_date',
       'duplicate_po', 'item_missing_in_po'].includes(r)
    )
  ) {
    // If ALL items have issues → full mismatch; else partial
    const hasOkItem = itemDetails.some((i) => i.status === 'ok');
    status = hasOkItem ? 'partially_matched' : 'mismatch';
  } else {
    status = 'partially_matched';
  }

  return { status, reasons: reasonList, itemDetails };
}

module.exports = { runMatchLogic };