const { getDocumentById, computeAndSaveMatch } = require('../services/documentService');

// Fetch a parsed document by its ID
async function getDocument(req, res, next) {
  try {
    const { id } = req.params;
    const doc = await getDocumentById(id);

    if (!doc) {
      return res.status(404).json({
        error: `No document found with id: ${id}`,
      });
    }

    return res.json({
      success: true,
      document: doc,
    });
  } catch (err) {
    next(err);
  }
}

// Compute and return the latest match result for a given PO number
async function getMatchResult(req, res, next) {
  try {
    const { poNumber } = req.params;

    if (!poNumber) {
      return res.status(400).json({ error: 'poNumber is required' });
    }

    const result = await computeAndSaveMatch(poNumber);

    return res.json({
      success: true,
      poNumber,
      status: result.status,
      reasons: result.reasons,
      linkedDocuments: result.linkedDocuments,
      itemDetails: result.itemDetails,
      lastUpdated: result.lastUpdated,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDocument, getMatchResult };