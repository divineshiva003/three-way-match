const { processUpload } = require('../services/documentService');

const VALID_TYPES = ['po', 'grn', 'invoice'];

async function uploadDocument(req, res, next) {
  try {
    // Validate
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded. Include a file field in form-data.',
      });
    }

    const documentType = (req.body.documentType || '').toLowerCase();
    if (!VALID_TYPES.includes(documentType)) {
      return res.status(400).json({
        error: `documentType must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    // Delegate to service
    const result = await processUpload(req.file.path, documentType);

    return res.status(201).json({
      success: true,
      message: 'Document uploaded, parsed, and matched successfully',
      documentId: result.documentId,
      documentType: result.documentType,
      poNumber: result.poNumber,
      parsedData: result.data,
      matchStatus: result.matchStatus,
      matchReasons: result.matchReasons,
    });
  } catch (err) {
    next(err); // Passes to errorHandler middleware
  }
}

module.exports = { uploadDocument };