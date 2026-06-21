const express = require('express');
const router = express.Router();

const upload = require('../middleware/upload');

// Controllers
const { uploadDocument } = require('../controllers/uploadController');
const { getDocument, getMatchResult } = require('../controllers/matchController');


// Document upload with file middleware
router.post(
  '/documents/upload',
  upload.single('file'),
  uploadDocument
);

// Fetch document by ID
router.get('/documents/:id', getDocument);

// Retrieve match result for a PO
router.get('/match/:poNumber', getMatchResult);


module.exports = router;