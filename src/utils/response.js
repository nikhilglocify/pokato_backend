/**
 * Standardized API response format
 * Matches Firebase Functions response structure
 */

const successResponse = (data, message = 'Success') => {
  return {
    status: 'success',
    message,
    data,
  };
};

const errorResponse = (message, code = 'error') => {
  return {
    status: 'error',
    message,
    code,
  };
};

module.exports = {
  successResponse,
  errorResponse,
};
