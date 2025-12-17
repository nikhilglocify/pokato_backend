// IMPORTANT: Load environment variables FIRST before any other imports
require('./config/env.js');

const express = require('express');
const cors = require('cors');
require('express-async-errors');

// Import database
const prisma = require('./config/database.js');

// Import routes
const stripeRoutes = require('./modules/stripe/routes.js');
const readerRoutes = require('./modules/readers/routes.js');
const paymentRoutes = require('./modules/payment/routes.js');
const userRoutes = require('./modules/user/routes.js');

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
app.get('/health', async (req, res) => {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      status: 'ok',
      message: 'Server is running',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Server is running but database is disconnected',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// API Routes
app.use('/api/stripe', stripeRoutes);
app.use('/api/readers', readerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/user', userRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

/**
 * Validate required environment variables before starting server
 */
function validateEnvironmentVariables() {
  const requiredEnvVars = {
    JWT_SECRET: {
      name: 'JWT_SECRET',
      description: 'Secret key for signing JWT tokens',
      generateCommand: 'openssl rand -base64 32',
    },
  };

  const missingVars = [];
  const weakVars = [];

  for (const [key, config] of Object.entries(requiredEnvVars)) {
    const value = process.env[key];
    
    if (!value) {
      missingVars.push(config);
    } else if (key === 'JWT_SECRET' && (value === 'your-secret-key-change-in-production' || value.length < 32)) {
      weakVars.push(config);
    }
  }

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach((config) => {
      console.error(`   - ${config.name}: ${config.description}`);
      if (config.generateCommand) {
        console.error(`     💡 Generate: ${config.generateCommand}`);
      }
    });
    console.error('\n💡 Please set these variables in your .env file');
    return false;
  }

  if (weakVars.length > 0) {
    console.warn('⚠️  WARNING: Weak environment variables detected:');
    weakVars.forEach((config) => {
      console.warn(`   - ${config.name}: Appears to be default or weak value`);
      if (config.generateCommand) {
        console.warn(`     💡 Generate secure value: ${config.generateCommand}`);
      }
    });
    console.warn('⚠️  This is a security risk. Please use strong, randomly generated secrets.\n');
  }

  return true;
}

/**
 * Check database connectivity before starting server
 */
async function checkDatabaseConnection() {
  try {
    console.log('🔍 Checking database connection...');
    await prisma.$connect();
    
    // Test query to ensure database is accessible
    await prisma.$queryRaw`SELECT 1`;
    
    console.log('✅ Database connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('💡 Make sure:');
    console.error('   1. PostgreSQL is running');
    console.error('   2. DATABASE_URL is correct in .env file');
    console.error('   3. Database exists and is accessible');
    return false;
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown() {
  console.log('\n🛑 Shutting down server...');
  try {
    await prisma.$disconnect();
    console.log('✅ Database disconnected');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start server with validation checks
async function startServer() {
  // Validate environment variables first
  console.log('🔍 Validating environment variables...');
  const envValid = validateEnvironmentVariables();
  
  if (!envValid) {
    console.error('❌ Cannot start server without required environment variables');
    process.exit(1);
  }
  console.log('✅ Environment variables validated');
  
  // Check database connection
  const dbConnected = await checkDatabaseConnection();
  
  if (!dbConnected) {
    console.error('❌ Cannot start server without database connection');
    process.exit(1);
  }
  
  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
    console.log(`💾 Database: Connected`);
  });
}

// Start the server
startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
