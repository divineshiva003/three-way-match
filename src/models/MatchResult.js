const mongoose = require('mongoose');

const itemMatchDetailSchema = new mongoose.Schema(
  {
    itemCode: String,
    description: String,
    poQty: Number,
    totalGrnQty: Number,
    totalInvoiceQty: Number,
    issues: [String],
    status: {
      type: String,
      enum: ['ok', 'warning', 'mismatch'],
      default: 'ok',
    },
  },
  { _id: false }
);

const matchResultSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['matched', 'partially_matched', 'mismatch', 'insufficient_documents'],
      default: 'insufficient_documents',
    },
    reasons: [String],
    linkedDocuments: {
      poId: String,
      grnIds: [String],
      invoiceIds: [String],
    },
    itemDetails: [itemMatchDetailSchema],
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MatchResult', matchResultSchema);