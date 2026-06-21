const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Strict prompts to enforce structured JSON output
const PROMPTS = {
  po: `You are a document parser. Extract data from this Purchase Order PDF.
Return ONLY a valid JSON object. No markdown. No explanation. No code fences.

Required structure:
{
  "poNumber": "the PO number (also called PO No, Order No)",
  "poDate": "YYYY-MM-DD format",
  "vendorName": "vendor/supplier name",
  "vendorGstin": "vendor GSTIN if present, else null",
  "buyerName": "buyer/purchaser company name",
  "items": [
    {
      "itemCode": "item code or SKU code from the Item Code column",
      "description": "item description",
      "quantity": <number, not string>,
      "unitPrice": <number>,
      "hsnCode": "HSN/SAC code if present"
    }
  ]
}

Important: quantity and unitPrice must be numbers, not strings.`,

  grn: `You are a document parser. Extract data from this Goods Receipt Note (GRN) PDF.
Return ONLY a valid JSON object. No markdown. No explanation. No code fences.

Required structure:
{
  "grnNumber": "GRN number (also called GRN No, Inbound No)",
  "poNumber": "the PO number this GRN references (look for PO No field)",
  "grnDate": "YYYY-MM-DD format (GRN Date or Create Date)",
  "invoiceNumber": "invoice number referenced, or null",
  "vendorName": "vendor name",
  "items": [
    {
      "itemCode": "SKU Code from the SKU Code column",
      "description": "SKU description",
      "expectedQuantity": <number — Exp Qty column>,
      "receivedQuantity": <number — Recv Qty column>,
      "unitPrice": <number>
    }
  ]
}

Important: all quantity fields must be numbers. Use Exp Qty for expectedQuantity and Recv Qty for receivedQuantity.`,

  invoice: `You are a document parser. Extract data from this Tax Invoice PDF.
Return ONLY a valid JSON object. No markdown. No explanation. No code fences.

Required structure:
{
  "invoiceNumber": "invoice number (Invoice No field)",
  "poNumber": "PO number — look for Customer Order No field",
  "invoiceDate": "YYYY-MM-DD format",
  "vendorName": "the company issuing this invoice (the seller)",
  "buyerName": "the bill-to company name",
  "totalAmount": <total invoice amount as number>,
  "items": [
    {
      "itemCode": "Item Code from the Item Code column",
      "description": "item description",
      "quantity": <number from Qty column>,
      "unitPrice": <number from Rate column>,
      "taxableValue": <number from Taxable Value column>
    }
  ]
}

Important: quantity, unitPrice, taxableValue must be numbers not strings.`,
};

// Parse document using Gemini Vision
async function parseDocument(filePath, documentType) {
  const prompt = PROMPTS[documentType];
  if (!prompt) throw new Error(`No prompt defined for document type: ${documentType}`);

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypeMap = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };

  const mimeType = mimeTypeMap[ext];
  if (!mimeType) throw new Error(`Unsupported file type: ${ext}`);

  const fileData = fs.readFileSync(filePath);
  const base64Data = fileData.toString('base64');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Data } },
    prompt,
  ]);

  const raw = result.response.text().trim();

  // Strip markdown fences if model wraps JSON
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Gemini returned invalid JSON for ${documentType}.\nRaw output: ${raw.substring(0, 300)}`
    );
  }

  return parsed;
}

module.exports = { parseDocument };