const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    documentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['po', 'grn', 'invoice'],
      required: true,
      index: true,
    },
    poNumber: {
      type: String,
      required: true,
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    rawFilePath: String,
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index: most common query pattern
documentSchema.index({ poNumber: 1, type: 1 });

module.exports = mongoose.model('Document', documentSchema);