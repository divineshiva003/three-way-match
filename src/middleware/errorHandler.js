function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Multer errors (file size, wrong type)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large. Maximum size is 20MB.',
    });
  }

  // Handle schema validation errors (Mongoose)
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(422).json({
      success: false,
      error: 'Validation failed',
      details: messages,
    });
  }

  // Handle duplicate key conflicts (Mongoose)
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: 'A document with this ID already exists.',
    });
  }

  // Handle AI parsing failures (Gemini)
  if (err.message?.includes('Gemini returned invalid JSON')) {
    return res.status(422).json({
      success: false,
      error: 'Document parsing failed. Gemini could not extract structured data.',
      detail: err.message,
    });
  }

  // Handle missing/normalization errors
  if (err.message?.includes('is missing from parsed')) {
    return res.status(422).json({
      success: false,
      error: err.message,
    });
  }

  // Fallback for all other errors
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;