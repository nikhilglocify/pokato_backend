// IMPORTANT: Load environment variables FIRST before any other imports
require('./config/env.js');

const express = require('express');
const cors = require('cors');
require('express-async-errors');

// Import routes
const stripeRoutes = require('./modules/stripe/routes.js');
const readerRoutes = require('./modules/readers/routes.js');
const paymentRoutes = require('./modules/payment/routes.js');

// Import middleware
const logger = require('./middleware/logger.js');
const { errorHandler } = require('./middleware/errorHandler.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:8081',
  credentials: true,
}));
app.use(express.json());

// Request logging middleware (should be after body parser)
app.use(logger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// API Routes
app.use('/api/stripe', stripeRoutes);
app.use('/api/readers', readerRoutes);
app.use('/api/payments', paymentRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
});
