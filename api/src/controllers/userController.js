const { Timestamp } = require('firebase-admin/firestore');
const { auth, admin, firestore } = require('../config/firebase');
const { VALID_ROLES, ADMIN_ROLE } = require('../utils/constants');
const { uid } = require('uid');
const { AddToDatabase } = require('../utils/functions');
const SearchQuery = require('../utils/searchQuery.js');
const uniqueID = uid;

exports.getUsersDataArr = (ids) => ids.map((id) => ({ uid: id }));
exports.getUsersBasedOnId = async (ids = []) =>
  await auth.getUsers(getUsersDataArr(ids));

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

const pageTokensMap = new Map();
const searchResultsCache = new Map();

exports.isNotAdmin = (req, res) => {
  const { user } = req;
  if (!user || user.role !== ADMIN_ROLE) {
    return res.status(403).json({
      status: 'error',
      error: 'Forbidden',
      message: 'Insufficient permissions to access user data',
    });
  } else {
    return false;
  }
};

exports.getAllUsersData = async (req, res, next) => {
  const { body } = req;
  const { search } = body;
  const page = parseInt(body.page) || 0;
  const PAGE_SIZE = 10;

  try {
    const { user } = req;

    // Verify admin access
    this.isNotAdmin(req, res);
    // Handle search case
    if (search?.length) {
      const cacheKey = JSON.stringify(search);
      let allSearchResults = searchResultsCache.get(cacheKey);

      if (!allSearchResults) {
        // Fetch all users for search
        let allUsers = [];
        let nextPageToken = undefined;

        do {
          const batch = await auth.listUsers(1000, nextPageToken);
          const userPromises = batch.users.map(processUserRecord);
          const processedUsers = await Promise.all(userPromises);
          allUsers = allUsers.concat(
            processedUsers.filter((user) => user !== null)
          );
          nextPageToken = batch.pageToken;
        } while (nextPageToken);

        // Perform search on all users
        allSearchResults = SearchQuery(search, allUsers);

        // Cache the results for subsequent pages
        searchResultsCache.set(cacheKey, allSearchResults);

        // Clear old cache entries after 5 minutes
        setTimeout(() => {
          searchResultsCache.delete(cacheKey);
        }, 5 * 60 * 1000);
      }

      // Paginate search results
      const startIndex = page * PAGE_SIZE;
      const paginatedResults = allSearchResults.slice(
        startIndex,
        startIndex + PAGE_SIZE
      );

      return res.status(200).json({
        status: 'success',
        data: {
          users: paginatedResults,
          totalCount: allSearchResults.length,
          currentPage: page,
          totalPages: Math.ceil(allSearchResults.length / PAGE_SIZE),
          hasNextPage: startIndex + PAGE_SIZE < allSearchResults.length,
        },
      });
    }

    // Handle regular listing case
    let listUsersResult;
    if (page === 0) {
      listUsersResult = await auth.listUsers(PAGE_SIZE);
    } else {
      const nextPageToken = pageTokensMap.get(page);
      if (!nextPageToken) {
        return res.status(400).json({
          status: 'error',
          error: 'Invalid Page',
          message: 'The requested page is not available',
        });
      }
      listUsersResult = await auth.listUsers(PAGE_SIZE, nextPageToken);
    }

    // Store the next page token if it exists
    if (listUsersResult.pageToken) {
      pageTokensMap.set(page + 1, listUsersResult.pageToken);

      // Clear old tokens after 5 minutes
      setTimeout(() => {
        pageTokensMap.delete(page + 1);
      }, 5 * 60 * 1000);
    }

    // Process users
    const userPromises = listUsersResult.users.map(processUserRecord);
    const users = await Promise.all(userPromises);
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
        currentPage: page,
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

/**
 * Helper function to determine if cache or tokens are still valid
 * @param {Map} cache - The cache Map to check
 * @param {string|number} key - The key to check
 * @returns {boolean} - Whether the cache entry is still valid
 */
function isCacheValid(cache, key) {
  const entry = cache.get(key);
  return entry && Date.now() - entry.timestamp < 5 * 60 * 1000; // 5 minutes
}

/**
 * Cleans up expired cache entries and tokens
 */
function cleanupCaches() {
  const now = Date.now();

  // Clean up search results cache
  for (const [key, value] of searchResultsCache.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      searchResultsCache.delete(key);
    }
  }

  // Clean up page tokens
  for (const [page, token] of pageTokensMap.entries()) {
    if (now - token.timestamp > 5 * 60 * 1000) {
      pageTokensMap.delete(page);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupCaches, 5 * 60 * 1000);

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
      const users = await this.getUsersBasedOnId(idsArr);

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
