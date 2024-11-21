const { Timestamp } = require('firebase-admin/firestore');
const { auth, admin, firestore } = require('../config/firebase');
const { VALID_ROLES, ADMIN_ROLE } = require('../utils/constants');
const { uid } = require('uid');
const { AddToDatabase, getUsersBasedOnId } = require('../utils/functions');
const getAllUsersForAdmin = require('./getAllUsersForAdmin');
const getAllUsersForOthers = require('./getAllUsersForOthers');

const uniqueID = uid;

exports.signUp = async (req, res, next) => {
  const { email, password, firstName, lastName, role } = req.body;

  try {
    const displayName = `${firstName} ${lastName}`;

    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });

    const uid = userRecord?.uid;

    const isAdminClaim = String(email).includes(process.env.ADMIN_EMAIL);

    if (VALID_ROLES.includes(role)) {
      const customUserClaimsObj = { role: role, admin: false };
      let databaseResponse = '';

      if (isAdminClaim) {
        customUserClaimsObj.admin = true;
        customUserClaimsObj.role = ADMIN_ROLE;
      } else {
        // Prepare data for non-admin users
        const data = {
          uid,
          isProfileComplete: false,
          createdAt: Timestamp.now(),
        };

        // Generate a custom ID for the user
        const customID = `${String(role).substring(0, 3)}_${uniqueID(6)}`;
        data[`${role}_id`] = customID;

        // Add user data to the database
        databaseResponse = await AddToDatabase(data, role);
        databaseResponse = await databaseResponse?.data();
      }

      // Set custom claims for the user
      await auth.setCustomUserClaims(uid, customUserClaimsObj);

      const responseObj = {
        uid,
        firstName,
        lastName,
        ...customUserClaimsObj,
        createdAt: Timestamp.now()?.toDate()?.toDateString(),
        profile: { ...databaseResponse },
      };

      // Create a custom token for the user
      const token = await admin
        .auth()
        .createCustomToken(uid, customUserClaimsObj);

      if (responseObj.profile && responseObj.profile.createdAt) {
        responseObj.profile.createdAt = responseObj.profile.createdAt
          ?.toDate()
          .toDateString();
      }

      // Send successful response
      res.status(201).send({
        message: `Welcome to MedJournal, ${displayName}`,
        user: responseObj,
        token,
      });
    } else {
      // Send error response for invalid role
      res.status(422).send({
        error: 'Invalid Role Selection',
        message: 'Please select proper role to continue',
      });
    }
  } catch (error) {
    next(error);
  }
};

exports.getUserData = async (req, res, next) => {
  const { query } = req;
  const { ids } = query;

  if (!ids) {
    res.status(400).send({
      error: 'Invalid Query',
      message: 'Please provide ids to get data',
    });
  } else {
    const idsArr = ids.split(',');

    try {
      const users = await getUsersBasedOnId(idsArr);

      const userJSON = users.users.map((user) => user?.toJSON());
      const notFound = [];

      if (users?.notFound?.length) {
        users?.notFound?.forEach((user) => notFound.push(user?.uid));
      }

      const responseObj = {
        users: userJSON,
        notFound,
      };

      res.status(200).send(responseObj);
    } catch (error) {
      next(error);
    }
  }
};

/**
 * Updates a user's profile picture URL in Firebase Authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Promise<Object>} Response object with status and message
 */
exports.updateProfilePicture = async (req, res, next) => {
  try {
    const { photoURL } = req.body;
    const { user } = req;
    const { uid } = user;

    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_UID',
        message: 'Please provide a valid user ID',
      });
    }

    if (!photoURL || typeof photoURL !== 'string' || !isValidUrl(photoURL)) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_URL',
        message: 'Please provide a valid profile picture URL',
      });
    }

    // Update the user's profile picture
    await auth.updateUser(uid, { photoURL });

    // Return success response
    return res.status(200).json({
      status: 'success',
      message: 'Profile picture updated successfully',
      data: {
        uid,
        photoURL,
      },
    });
  } catch (error) {
    // Handle specific Firebase Auth errors
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (error.code === 'auth/invalid-uid') {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_UID_FORMAT',
        message: 'Invalid user ID format',
      });
    }

    // Log the error for debugging
    console.error('Profile picture update error:', error);

    // Return generic error for unhandled cases
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to update profile picture',
    });
  }
};

/**
 * Validates if the provided string is a valid URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is valid, false otherwise
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

exports.getAllUsers = async (req, res, next) => {
  try {
    const { user } = req;

    if (user) {
      if (user?.role === ADMIN_ROLE || user?.admin) {
        getAllUsersForAdmin(req, res);
      } else {
        getAllUsersForOthers(req, res);
      }
    } else {
    }
  } catch (error) {
    console.error('Error listing users:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Internal Server Error',
      message: 'Failed to retrieve user list',
    });
  }
};
