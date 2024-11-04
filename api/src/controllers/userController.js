const { Timestamp } = require('firebase-admin/firestore');
const { auth, admin, firestore } = require('../config/firebase');
const {
  VALID_ROLES,
  ADMIN_ROLE,
  CACHE_DURATION,
} = require('../utils/constants');
const { uid } = require('uid');
const { AddToDatabase } = require('../utils/functions');
const SearchQuery = require('../utils/searchQuery.js');
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

// Cache configurations
const PAGE_SIZE = 10;
const pageTokensMap = new Map();
const searchResultsCache = new Map();

/**
 * Get all users with pagination and search support
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.getAllUsersData = async (req, res, next) => {
  const { body } = req;
  const { search } = body;
  const page = Math.max(0, parseInt(body.page) || 0); // Ensure non-negative page

  try {
    // Validate admin access
    if (!req.user?.role === ADMIN_ROLE) {
      return res.status(403).json({
        status: 'error',
        error: 'Forbidden',
        message: 'Insufficient permissions to access user data',
      });
    }

    // Handle search functionality
    if (Array.isArray(search) && search.length > 0) {
      return await handleSearchRequest(search, page, res);
    }

    // Handle regular listing
    return await handleRegularListing(page, res);
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
 * Handle search-based user requests
 * @param {string[]} search - Search terms
 * @param {number} page - Page number
 * @param {Object} res - Express response object
 */
async function handleSearchRequest(search, page, res) {
  const cacheKey = JSON.stringify(search);
  let searchResults = searchResultsCache.get(cacheKey);

  if (!searchResults || !isCacheValid(searchResultsCache, cacheKey)) {
    searchResults = await fetchAndProcessAllUsers(search);
    cacheSearchResults(cacheKey, searchResults);
  }

  const paginatedData = paginateResults(searchResults, page);

  return res.status(200).json({
    status: 'success',
    data: {
      ...paginatedData,
      totalPages: Math.ceil(searchResults.length / PAGE_SIZE),
    },
  });
}

/**
 * Handle regular user listing requests
 * @param {number} page - Page number
 * @param {Object} res - Express response object
 */
async function handleRegularListing(page, res) {
  try {
    const { users, pageToken } = await fetchUsersBatch(page);

    if (pageToken) {
      updatePageTokenCache(page + 1, pageToken);
    }

    const processedUsers = await processUsers(users);
    const pageTokens = generatePageTokensArray(page);

    return res.status(200).json({
      status: 'success',
      data: {
        users: processedUsers,
        totalCount: processedUsers.length,
        currentPage: page,
        pageTokens,
        hasNextPage: Boolean(pageToken),
      },
    });
  } catch (error) {
    if (error.code === 'INVALID_PAGE') {
      return res.status(400).json({
        status: 'error',
        error: 'Invalid Page',
        message: 'The requested page is not available',
      });
    }
    throw error;
  }
}

/**
 * Fetch and process all users for search
 * @param {string[]} search - Search terms
 * @returns {Promise<Array>} Processed and filtered users
 */
async function fetchAndProcessAllUsers(search) {
  const allUsers = [];
  let nextPageToken;

  do {
    const batch = await auth.listUsers(1000, nextPageToken);
    const processedBatch = await Promise.all(
      batch.users.map(processUserRecord)
    );
    allUsers.push(...processedBatch.filter(Boolean));
    nextPageToken = batch.pageToken;
  } while (nextPageToken);

  return SearchQuery(search, allUsers);
}

/**
 * Fetch a batch of users for regular listing
 * @param {number} page - Page number
 * @returns {Promise<Object>} Users and page token
 */
async function fetchUsersBatch(page) {
  if (page === 0) {
    return auth.listUsers(PAGE_SIZE);
  }

  const nextPageToken = pageTokensMap.get(page);
  if (!nextPageToken) {
    const error = new Error('Invalid page requested');
    error.code = 'INVALID_PAGE';
    throw error;
  }

  return auth.listUsers(PAGE_SIZE, nextPageToken);
}

/**
 * Process a batch of user records
 * @param {Array} users - Array of user records
 * @returns {Promise<Array>} Processed user records
 */
async function processUsers(users) {
  const processed = await Promise.all(users.map(processUserRecord));
  return processed.filter(Boolean);
}

/**
 * Cache search results with expiration
 * @param {string} key - Cache key
 * @param {Array} results - Search results
 */
function cacheSearchResults(key, results) {
  searchResultsCache.set(key, {
    data: results,
    timestamp: Date.now(),
  });

  setTimeout(() => {
    if (searchResultsCache.has(key)) {
      searchResultsCache.delete(key);
    }
  }, CACHE_DURATION);
}

/**
 * Update page token cache
 * @param {number} page - Page number
 * @param {string} token - Page token
 */
function updatePageTokenCache(page, token) {
  pageTokensMap.set(page, {
    token,
    timestamp: Date.now(),
  });

  setTimeout(() => {
    if (pageTokensMap.has(page)) {
      pageTokensMap.delete(page);
    }
  }, CACHE_DURATION);
}

/**
 * Generate page tokens array
 * @param {number} currentPage - Current page number
 * @returns {Array<boolean>} Array of page token availability
 */
function generatePageTokensArray(currentPage) {
  const pageTokens = [];
  for (let i = 0; i <= currentPage + 1; i++) {
    pageTokens[i] = pageTokensMap.has(i);
  }
  return pageTokens;
}

/**
 * Paginate search results
 * @param {Array} results - Search results
 * @param {number} page - Page number
 * @returns {Object} Paginated data
 */
function paginateResults(results, page) {
  const startIndex = page * PAGE_SIZE;
  const paginatedUsers = results.slice(startIndex, startIndex + PAGE_SIZE);

  return {
    users: paginatedUsers,
    totalCount: results.length,
    currentPage: page,
    hasNextPage: startIndex + PAGE_SIZE < results.length,
  };
}

/**
 * Check if cache entry is still valid
 * @param {Map} cache - Cache map
 * @param {string|number} key - Cache key
 * @returns {boolean} Cache validity
 */
function isCacheValid(cache, key) {
  const entry = cache.get(key);
  return entry?.timestamp && Date.now() - entry.timestamp < CACHE_DURATION;
}

// Cleanup job
setInterval(() => {
  const now = Date.now();

  // Cleanup search cache
  for (const [key, value] of searchResultsCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      searchResultsCache.delete(key);
    }
  }

  // Cleanup page tokens
  for (const [page, value] of pageTokensMap.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      pageTokensMap.delete(page);
    }
  }
}, CACHE_DURATION);

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
