const { Timestamp } = require('firebase-admin/firestore');
const { auth, admin, firestore } = require('../config/firebase');
const { VALID_ROLES, ADMIN_ROLE } = require('../utils/constants');
const { uid } = require('uid');
const { AddToDatabase } = require('../utils/functions');
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

/**
 * Gets profile data for a user from Firestore
 * @param {string} uid - User ID
 * @param {string} role - User role
 * @returns {Promise<Object|null>} Profile data or null
 */
const getProfileData = async (uid, role) => {
  try {
    if (role && role !== ADMIN_ROLE) {
      const profileSnapshot = await firestore.collection(role).doc(uid).get();
      if (profileSnapshot.exists) {
        return profileSnapshot.data();
      }
    }
    return null;
  } catch (error) {
    console.error(`Error fetching profile for user ${uid}:`, error);
    return null;
  }
};

/**
 * Processes a single user record and fetches additional data
 * @param {Object} userRecord - Firebase user record
 * @returns {Promise<Object>} Processed user data
 */
const processUserRecord = async (userRecord) => {
  try {
    const userData = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      disabled: userRecord.disabled,
      role: userRecord.customClaims?.role,
      isAdmin: userRecord.customClaims?.isAdmin,
      createdAt: userRecord.metadata.creationTime,
      lastSignIn: userRecord.metadata.lastSignInTime,
      emailVerified: userRecord.emailVerified,
    };

    // Fetch profile data if user has a role and is not admin
    if (userData.role && !userData.isAdmin) {
      userData.profile = await getProfileData(userData.uid, userData.role);
    }

    return userData;
  } catch (error) {
    console.error(`Error processing user ${userRecord.uid}:`, error);
    return null;
  }
};

const pageTokensMap = new Map(); // Store pageTokens at module level

exports.getAllUsersData = async (req, res, next) => {
  const page = parseInt(req.query.page) || 0;
  
  try {
    const { user } = req;

    // Verify admin access
    if (!user || user.role !== ADMIN_ROLE) {
      return res.status(403).json({
        status: 'error',
        error: 'Forbidden',
        message: 'Insufficient permissions to access user data',
      });
    }

    let listUsersResult;
    
    // For first page, don't pass any token
    if (page === 0) {
      listUsersResult = await auth.listUsers(10);
    } else {
      // Get the page token for the requested page
      const nextPageToken = pageTokensMap.get(page);
      if (!nextPageToken) {
        return res.status(400).json({
          status: 'error',
          error: 'Invalid Page',
          message: 'The requested page is not available',
        });
      }
      listUsersResult = await auth.listUsers(10, nextPageToken);
    }
    
    // Store the next page token if it exists
    if (listUsersResult.pageToken) {
      pageTokensMap.set(page + 1, listUsersResult.pageToken);
    }

    // Process all users concurrently and wait for all promises to resolve
    const userPromises = listUsersResult.users.map(processUserRecord);
    const users = await Promise.all(userPromises);

    // Filter out any null results from failed processing
    const validUsers = users.filter((user) => user !== null);

    // Create pageTokens array for response
    const pageTokens = [];
    for (let i = 0; i <= page + 1; i++) {
      pageTokens[i] = pageTokensMap.has(i);
    }

    return res.status(200).json({
      status: 'success',
      data: {
        users: validUsers,
        totalCount: validUsers.length,
        pageTokens,
        hasNextPage: Boolean(listUsersResult.pageToken),
      },
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Internal Server Error',
      message: 'Failed to retrieve user list',
    });
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
    const getDataArr = idsArr.map((id) => ({ uid: id }));

    try {
      const users = await auth.getUsers(getDataArr);

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
