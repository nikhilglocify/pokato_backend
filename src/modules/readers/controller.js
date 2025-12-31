const { successResponse, errorResponse } = require('../../utils/response.js');
const {
  validateStripeAccount,
  listLocationsService,
  createLocationService,
  getOrCreateLocationService,
  registerReaderService,
} = require('./services.js');

/**
 * List all locations for the user's Stripe account
 * GET /api/readers/locations
 */
const listLocations = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Call service to list locations
    const locations = await listLocationsService(accountId);

    res.json(successResponse({
      locations,
    }, 'Locations retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new location for the user's Stripe account
 * POST /api/readers/locations
 */
const createLocation = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { displayName, address } = req.body;

    // Input validation
    if (!displayName) {
      return res.status(400).json(errorResponse('Display name is required', 'invalid-argument'));
    }

    if (!address?.line1 || !address?.city || !address?.state || !address?.country || !address?.postal_code) {
      return res.status(400).json(errorResponse(
        'Complete address is required (line1, city, state, country, postal_code)',
        'invalid-argument'
      ));
    }

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Call service to create location
    const newLocation = await createLocationService(accountId, { displayName, address });

    res.json(successResponse(newLocation, 'Location created successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get or create a location for the user's Stripe account
 * GET /api/readers/locations/get-or-create
 */
const getOrCreateLocation = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Call service to get or create location
    const location = await getOrCreateLocationService(accountId);

    res.json(successResponse(location, 'Location retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Register a Terminal reader
 * POST /api/readers/register
 */
const registerReader = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { registrationCode, locationId, label } = req.body;

    // Input validation
    if (!registrationCode) {
      return res.status(400).json(errorResponse('Registration code is required', 'invalid-argument'));
    }

    if (!locationId) {
      return res.status(400).json(errorResponse('Location ID is required', 'invalid-argument'));
    }

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Call service to register reader
    const reader = await registerReaderService(accountId, {
      registrationCode,
      locationId,
      label,
    });

    res.json(successResponse(reader, 'Reader registered successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerReader,
  listLocations,
  createLocation,
  getOrCreateLocation,
};
