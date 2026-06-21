// Safe parsing helpers for inconsistent LLM output
function safeDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function safeNumber(raw) {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

function safeString(raw) {
  return (raw || '').toString().trim();
}

// Normalize PO item with alias handling

function normalizePoItem(item) {
  return {
    itemCode: safeString(item.itemCode || item.sku || item.item_code || ''),
    description: safeString(item.description || item.name || ''),
    quantity: safeNumber(item.quantity || item.qty || 0),
    unitPrice: safeNumber(item.unitPrice || item.unit_price || item.rate || 0),
    hsnCode: safeString(item.hsnCode || item.hsn_code || item.hsn || ''),
  };
}

// Normalize GRN item with multiple field variants
function normalizeGrnItem(item) {
  return {
    itemCode: safeString(item.itemCode || item.sku || item.skuCode || item.item_code || ''),
    description: safeString(item.description || item.skuDesc || item.name || ''),
    expectedQuantity: safeNumber(
      item.expectedQuantity || item.exp_qty || item.expQty || item.orderedQuantity || 0
    ),
    receivedQuantity: safeNumber(
      item.receivedQuantity || item.recv_qty || item.recvQty || item.receivedQty || 0
    ),
    unitPrice: safeNumber(item.unitPrice || item.unit_price || item.rate || 0),
  };
}

// Normalize Invoice item with alias handling
function normalizeInvoiceItem(item) {
  return {
    itemCode: safeString(item.itemCode || item.sku || item.item_code || ''),
    description: safeString(item.description || item.name || ''),
    quantity: safeNumber(item.quantity || item.qty || 0),
    unitPrice: safeNumber(item.unitPrice || item.unit_price || item.rate || 0),
    taxableValue: safeNumber(item.taxableValue || item.taxable_value || item.amount || 0),
  };
}

// Normalize PO document and enforce required fields
function normalizePO(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid PO data from Gemini: expected an object');
  }

  const poNumber = safeString(raw.poNumber || raw.po_number || raw.poNo || '');
  if (!poNumber) throw new Error('PO number is missing from parsed output');

  return {
    poNumber,
    poDate: safeDate(raw.poDate || raw.po_date || raw.date),
    vendorName: safeString(raw.vendorName || raw.vendor_name || raw.vendor || ''),
    vendorGstin: safeString(raw.vendorGstin || raw.gstin || ''),
    buyerName: safeString(raw.buyerName || raw.buyer_name || raw.buyer || ''),
    items: Array.isArray(raw.items) ? raw.items.map(normalizePoItem) : [],
  };
}

// Normalize GRN document and enforce required fields
function normalizeGRN(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid GRN data from Gemini: expected an object');
  }

  const poNumber = safeString(
    raw.poNumber || raw.po_number || raw.poNo || raw.purchaseOrderNumber || ''
  );
  if (!poNumber) throw new Error('PO number is missing from parsed GRN output');

  const grnNumber = safeString(raw.grnNumber || raw.grn_number || raw.grnNo || raw.inboundNo || '');
  if (!grnNumber) throw new Error('GRN number is missing from parsed output');

  return {
    grnNumber,
    poNumber,
    grnDate: safeDate(raw.grnDate || raw.grn_date || raw.date || raw.createDate),
    invoiceNumber: safeString(raw.invoiceNumber || raw.invoice_number || raw.invoiceNo || ''),
    vendorName: safeString(raw.vendorName || raw.vendor_name || raw.vendor || ''),
    items: Array.isArray(raw.items) ? raw.items.map(normalizeGrnItem) : [],
  };
}

// Normalize Invoice document and enforce required fields
function normalizeInvoice(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Invoice data from Gemini: expected an object');
  }

  const poNumber = safeString(
    raw.poNumber ||
      raw.po_number ||
      raw.customerOrderNo ||
      raw.customer_order_no ||
      raw.purchaseOrderNumber ||
      ''
  );
  if (!poNumber) throw new Error('PO number is missing from parsed Invoice output');

  const invoiceNumber = safeString(
    raw.invoiceNumber || raw.invoice_number || raw.invoiceNo || raw.invoice_no || ''
  );
  if (!invoiceNumber) throw new Error('Invoice number is missing from parsed output');

  return {
    invoiceNumber,
    poNumber,
    invoiceDate: safeDate(raw.invoiceDate || raw.invoice_date || raw.date),
    vendorName: safeString(raw.vendorName || raw.vendor_name || raw.vendor || ''),
    buyerName: safeString(raw.buyerName || raw.buyer_name || raw.buyer || ''),
    totalAmount: safeNumber(raw.totalAmount || raw.total_amount || raw.grandTotal || 0),
    items: Array.isArray(raw.items) ? raw.items.map(normalizeInvoiceItem) : [],
  };
}

const normalizers = { po: normalizePO, grn: normalizeGRN, invoice: normalizeInvoice };

// Entry point for normalization
function normalizeDocument(type, raw) {
  const normalizer = normalizers[type];
  if (!normalizer) throw new Error(`Unknown document type: ${type}`);

  const data = normalizer(raw);
  return { poNumber: data.poNumber, data };
}

module.exports = { normalizeDocument, normalizePO, normalizeGRN, normalizeInvoice };