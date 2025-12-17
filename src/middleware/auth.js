const jwt = require('jsonwebtoken');
const prisma = require('../config/database.js');

// Validate JWT_SECRET is set - throw error if missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    '❌ JWT_SECRET environment variable is required but not set.\n' +
    '💡 Please set JWT_SECRET in your .env file.\n' +
    '💡 Generate a secure secret: openssl rand -base64 32\n' +
    '💡 Example: JWT_SECRET=your-super-secret-key-here'
  );
}

// Warn if using default/weak secret (security check)
if (JWT_SECRET === 'your-secret-key-change-in-production' || JWT_SECRET.length < 32) {
  console.warn(
    '⚠️  WARNING: JWT_SECRET appears to be weak or default value.\n' +
    '⚠️  This is a security risk. Please use a strong, randomly generated secret.\n' +
    '💡 Generate a secure secret: openssl rand -base64 32'
  );
}

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header and validates user exists in database
 * 
 * How it works:
 * 1. Extracts token from Authorization: Bearer <token> header
 * 2. Verifies token signature using JWT_SECRET (ensures token wasn't tampered with)
 * 3. Checks token expiration
 * 4. Extracts user info from token payload: { userId, email }
 * 5. Validates user exists in database (database lookup)
 * 6. Attaches user info to request object: req.user
 * 
 * Token is generated during Stripe OAuth callback (POST /api/stripe/oauth-callback)
 * There is no traditional login API - authentication happens through Stripe OAuth flow
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required. Please provide a valid token.',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      // Verify token signature and expiration
      // Token payload contains: { userId, email }
      // This was set when token was generated in handleOAuthCallback
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Validate that user exists in database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          stripeAccountId: true,
          stripeAccountStatus: true,
        },
      });
      
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'User not found. Please log in again.',
        });
      }
      
      // Attach user info to request object
      // Route handlers can access: req.user.userId, req.user.email, req.user.stripeAccountId
      req.user = {
        userId: user.id,
        email: user.email,
        stripeAccountId: user.stripeAccountId,
        stripeAccountStatus: user.stripeAccountStatus,
      };
      
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          status: 'error',
          message: 'Token expired. Please log in again.',
        });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid token. Please log in again.',
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Authentication error',
    });
  }
};

/**
 * Optional authentication middleware
 * Adds user to request if token is present, but doesn't fail if missing
 * Also validates user exists in database if token is valid
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Validate user exists in database
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            email: true,
            stripeAccountId: true,
            stripeAccountStatus: true,
          },
        });
        
        if (user) {
          req.user = {
            userId: user.id,
            email: user.email,
            stripeAccountId: user.stripeAccountId,
            stripeAccountStatus: user.stripeAccountStatus,
          };
        } else {
          req.user = null;
        }
      } catch (error) {
        // Token invalid, but continue without auth
        req.user = null;
      }
    }
    next();
  } catch (error) {
    // Continue without auth
    req.user = null;
    next();
  }
};

/**
 * Generate JWT token for user
 */
const generateToken = (payload) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '1d';
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

module.exports = {
  authenticate,
  optionalAuth,
  generateToken,
};
