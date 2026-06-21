const Document = require('../models/Document');

// Fetch and group all documents for a PO number
async function getAllDocumentsByPoNumber(poNumber) {
  const docs = await Document.find({ poNumber }).lean();

  const po = docs.find((d) => d.type === 'po') || null;
  const grns = docs.filter((d) => d.type === 'grn');
  const invoices = docs.filter((d) => d.type === 'invoice');

  // Check for duplicate POs (business rule)
  const poCount = docs.filter((d) => d.type === 'po').length;

  return { po, grns, invoices, hasDuplicatePO: poCount > 1 };
}

// Check existence of document types for a PO (lightweight)
async function getDocumentPresence(poNumber) {
  const types = await Document.distinct('type', { poNumber });
  return {
    hasPO: types.includes('po'),
    hasGRN: types.includes('grn'),
    hasInvoice: types.includes('invoice'),
  };
}

module.exports = { getAllDocumentsByPoNumber, getDocumentPresence };