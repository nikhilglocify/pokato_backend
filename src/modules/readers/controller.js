const { stripe } = require('../../config/stripe.js');
const prisma = require('../../config/database.js');
const { successResponse, errorResponse } = require('../../utils/response.js');

/**
 * List all locations for the user's Stripe account
 * GET /api/readers/locations
 */
const listLocations = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res.status(400).json(errorResponse(
        'Stripe account not connected. Please connect your Stripe account first.',
        'failed-precondition'
      ));
    }

    if (user.stripeAccountStatus !== 'active') {
      return res.status(400).json(errorResponse(
        'Stripe account is not active. Please complete the onboarding process.',
        'failed-precondition'
      ));
    }

    const accountId = user.stripeAccountId;

    // List all locations
    const locations = await stripe.terminal.locations.list(
      {},
      { stripeAccount: accountId }
    );

    res.json(successResponse({
      locations: locations.data.map(loc => ({
        id: loc.id,
        displayName: loc.display_name,
        address: loc.address,
      })),
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

    if (!displayName) {
      return res.status(400).json(errorResponse('Display name is required', 'invalid-argument'));
    }

    if (!address?.line1 || !address?.city || !address?.state || !address?.country || !address?.postal_code) {
      return res.status(400).json(errorResponse(
        'Complete address is required (line1, city, state, country, postal_code)',
        'invalid-argument'
      ));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res.status(400).json(errorResponse(
        'Stripe account not connected. Please connect your Stripe account first.',
        'failed-precondition'
      ));
    }

    if (user.stripeAccountStatus !== 'active') {
      return res.status(400).json(errorResponse(
        'Stripe account is not active. Please complete the onboarding process.',
        'failed-precondition'
      ));
    }

    const accountId = user.stripeAccountId;

    // Create new location
    const newLocation = await stripe.terminal.locations.create(
      {
        display_name: displayName,
        address: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          country: address.country,
          postal_code: address.postal_code,
        },
      },
      { stripeAccount: accountId }
    );

    res.json(successResponse({
      locationId: newLocation.id,
      displayName: newLocation.display_name,
      address: newLocation.address,
    }, 'Location created successfully'));
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res.status(400).json(errorResponse(
        'Stripe account not connected. Please connect your Stripe account first.',
        'failed-precondition'
      ));
    }

    if (user.stripeAccountStatus !== 'active') {
      return res.status(400).json(errorResponse(
        'Stripe account is not active. Please complete the onboarding process.',
        'failed-precondition'
      ));
    }

    const accountId = user.stripeAccountId;

    // List existing locations
    const locations = await stripe.terminal.locations.list(
      {},
      { stripeAccount: accountId }
    );

    // If location exists, return it
    if (locations.data.length > 0) {
      const location = locations.data[0];
      return res.json(successResponse({
        locationId: location.id,
        displayName: location.display_name,
        address: location.address,
      }, 'Location retrieved successfully'));
    }

    // Create a new location if none exists
    const newLocation = await stripe.terminal.locations.create(
      {
        display_name: 'Default Location',
        address: {
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          country: 'US',
          postal_code: '94102',
        },
      },
      { stripeAccount: accountId }
    );

    res.json(successResponse({
      locationId: newLocation.id,
      displayName: newLocation.display_name,
      address: newLocation.address,
    }, 'Location created successfully'));
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

    if (!registrationCode) {
      return res.status(400).json(errorResponse('Registration code is required', 'invalid-argument'));
    }

    if (!locationId) {
      return res.status(400).json(errorResponse('Location ID is required', 'invalid-argument'));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res.status(400).json(errorResponse(
        'Stripe account not connected. Please connect your Stripe account first.',
        'failed-precondition'
      ));
    }

    if (user.stripeAccountStatus !== 'active') {
      return res.status(400).json(errorResponse(
        'Stripe account is not active. Please complete the onboarding process.',
        'failed-precondition'
      ));
    }

    const accountId = user.stripeAccountId;

    // Register the reader using the registration code
    const reader = await stripe.terminal.readers.create(
      {
        registration_code: registrationCode,
        location: locationId,
        label: label || 'Terminal Reader',
      },
      { stripeAccount: accountId }
    );

    // Note: Readers are stored in Stripe, not in our database
    // We only store user and stripe_details

    res.json(successResponse({
      readerId: reader.id,
      serialNumber: reader.serial_number,
      label: reader.label,
      deviceType: reader.device_type,
      locationId: reader.location,
    }, 'Reader registered successfully'));
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
