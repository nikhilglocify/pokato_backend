/**
 * Request logging middleware
 * Logs all incoming API requests with method, URL, timestamp, and response status
 */

const logger = (req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  // Log request
  console.log(`\n📡 [${timestamp}] ${req.method} ${req.originalUrl || req.url}`);
  
  // Log query parameters if present
  if (Object.keys(req.query).length > 0) {
    console.log(`   Query:`, req.query);
  }
  
  // Log request body if present (excluding sensitive data)
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = { ...req.body };
    // Remove sensitive fields from logs
    if (sanitizedBody.code) {
      sanitizedBody.code = sanitizedBody.code.substring(0, 20) + '...';
    }
    if (sanitizedBody.state) {
      sanitizedBody.state = sanitizedBody.state.substring(0, 50) + '...';
    }
    if (sanitizedBody.password) {
      sanitizedBody.password = '***';
    }
    if (sanitizedBody.token) {
      sanitizedBody.token = sanitizedBody.token.substring(0, 20) + '...';
    }
    console.log(`   Body:`, sanitizedBody);
  }
  
  // Log user info if authenticated
  if (req.user) {
    console.log(`   User:`, {
      userId: req.user.userId,
      email: req.user.email,
      stripeAccountId: req.user.stripeAccountId,
    });
  }
  
  // Capture response status
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const statusEmoji = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode >= 400 ? '❌' : '⚠️';
    
    console.log(`   ${statusEmoji} [${statusCode}] ${duration}ms`);
    
    // Log response data (truncated for large responses)
    if (data && typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed.data && parsed.data.token) {
          parsed.data.token = parsed.data.token.substring(0, 20) + '...';
        }
        console.log(`   Response:`, JSON.stringify(parsed).substring(0, 200));
      } catch (e) {
        // Not JSON, log first 200 chars
        console.log(`   Response:`, data.substring(0, 200));
      }
    }
    
    console.log(''); // Empty line for readability
    
    originalSend.call(this, data);
  };
  
  next();
};

module.exports = logger;

