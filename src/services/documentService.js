const { v4: uuidv4 } = require('uuid');
const Document = require('../models/Document');
const MatchResult = require('../models/MatchResult');
const { parseDocument } = require('./geminiParser');
const { normalizeDocument } = require('../utils/normalize');
const { getAllDocumentsByPoNumber } = require('./aggregationService');
const { runMatchLogic } = require('./matchEngine');

// Process upload → parse → normalize → store → compute match
async function processUpload(filePath, documentType) {
  // Step 1: Parse with Gemini
  const rawParsed = await parseDocument(filePath, documentType);

  // Step 2: Normalize (DTO validation)
  const { poNumber, data } = normalizeDocument(documentType, rawParsed);

  // Step 3: Save to unified collection
  const documentId = uuidv4();
  await Document.create({
    documentId,
    type: documentType,
    poNumber,
    data,
    rawFilePath: filePath,
  });

  // Step 4: Compute match after save so this document is included
  const matchResult = await computeAndSaveMatch(poNumber);

  return {
    documentId,
    poNumber,
    documentType,
    data,
    matchStatus: matchResult.status,
    matchReasons: matchResult.reasons,
  };
}

// Fetch document by documentId
async function getDocumentById(documentId) {
  return Document.findOne({ documentId }).lean();
}

// Compute and persist match result for a PO
async function computeAndSaveMatch(poNumber) {
  // Aggregate related documents
  const { po, grns, invoices, hasDuplicatePO } = await getAllDocumentsByPoNumber(poNumber);

  // Run pure match logic (no DB calls inside)
  const { status, reasons, itemDetails } = runMatchLogic({ po, grns, invoices, hasDuplicatePO });

  // Persist result — upsert so we always have exactly one record per poNumber
  const matchResult = await MatchResult.findOneAndUpdate(
    { poNumber },
    {
      poNumber,
      status,
      reasons,
      linkedDocuments: {
        poId: po?.documentId || null,
        grnIds: grns.map((g) => g.documentId),
        invoiceIds: invoices.map((i) => i.documentId),
      },
      itemDetails,
      lastUpdated: new Date(),
    },
    { upsert: true, new: true }
  );

  return matchResult;
}

module.exports = { processUpload, getDocumentById, computeAndSaveMatch };