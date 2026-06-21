require('dotenv').config();
const express = require('express');

const connectDB = require('./src/config/db');
const routes = require('./src/routes');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

app.use(express.json());
app.use('/api', routes);

app.get('/', (req, res) => {
  res.send('Three-way match engine is running 🚀');
});

// Error handler must be registered last
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB connection error:', err.message);
    process.exit(1);
  });