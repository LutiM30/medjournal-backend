const { firestore } = require('../config/firebase');
const { MESSAGES, VALID_ROLES, ADMIN_ROLE } = require('./constants');
const { Timestamp } = require('firebase-admin/firestore');
const fuzzysort = require('fuzzysort');

const AddToDatabase = async (data, role) => {
  if (!VALID_ROLES.includes(role)) {
    throw MESSAGES.InvalidUserRole;
  } else {
    try {
      const collectionRef = firestore.collection(role);
      const docRef = collectionRef.doc(data.uid);

      await docRef.set(data);
      return await docRef.get();
    } catch (error) {
      console.error('Error AddToDatabase: ', error);
      throw error;
    }
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
      isAdmin:
        userRecord.customClaims?.isAdmin || userRecord.customClaims?.admin,
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

const isNotAdmin = (req, res) => {
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

const getUsersDataArr = (ids) => ids.map((id) => ({ uid: id }));
const getUsersBasedOnId = async (ids = []) =>
  await auth.getUsers(this.getUsersDataArr(ids));

/**
 * Flattens an object and prepares it for fuzzy searching while handling special cases
 * @param {Object} obj - The object to flatten
 * @returns {Object} - Flattened object with searchable string values
 */
function prepareSearchableObject(obj) {
  const searchable = {};

  function processValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'string') return value.toLowerCase();
    return '';
  }

  function flatten(current, prefix = '') {
    if (!current) return searchable;

    for (const key in current) {
      if (!current.hasOwnProperty(key)) continue;

      const value = current[key];
      const newKey = prefix ? `${prefix}.${key}` : key;

      // Skip specific types and fields
      if (
        value instanceof Timestamp ||
        value instanceof Date ||
        key.toLowerCase().includes('date') ||
        key === 'password' ||
        key === 'token' ||
        typeof value === 'function'
      ) {
        continue;
      }

      // Handle arrays
      if (Array.isArray(value)) {
        searchable[newKey] = value
          .map((item) => {
            if (typeof item === 'object' && item !== null) {
              return Object.values(flatten(item)).join(' ');
            }
            return processValue(item);
          })
          .filter(Boolean)
          .join(' ');
      }
      // Handle nested objects
      else if (typeof value === 'object' && value !== null) {
        flatten(value, newKey);
      }
      // Handle primitive values
      else {
        const processedValue = processValue(value);
        if (processedValue) {
          searchable[newKey] = processedValue;
        }
      }
    }
    return searchable;
  }

  const flattened = flatten(obj);
  // Create a single searchable string combining all values
  flattened.all = Object.values(flattened).filter(Boolean).join(' ');
  return flattened;
}

/**
 * Performs a fuzzy search across an array of objects
 * @param {string} searchQuery - The search term
 * @param {Array} data - Array of objects to search through
 * @param {Object} options - Search configuration options
 * @returns {Array} - Sorted array of matching results
 */
function performSearch(searchQuery, data, options = {}) {
  if (!searchQuery || !data?.length) return [];

  const { threshold = -10000, limit = 100, allowTypos = true } = options;

  const searchableData = data.map((item) => ({
    original: item,
    searchable: prepareSearchableObject(item),
  }));

  // Prepare the search query
  const query = searchQuery.toLowerCase().trim();

  // Perform the search on the combined 'all' field
  const results = fuzzysort.go(query, searchableData, {
    key: 'searchable.all',
    threshold,
    limit,
    allowTypo: allowTypos,
  });

  if (!results.length) {
    // Fallback to searching individual fields if no results found
    const fallbackResults = searchableData.filter((item) => {
      return Object.values(item.searchable).some((value) =>
        value.includes(query)
      );
    });

    return fallbackResults.map((item) => ({
      ...item.original,
      searchScore: 0,
    }));
  }

  // Map results back to original objects and add search score
  return results.map((result) => ({
    ...result.obj.original,
    searchScore: result.score,
  }));
}

/**
 * Main search function that handles multiple search terms
 * @param {string|Array} search - Search query or array of queries
 * @param {Array} searchFrom - Array of objects to search through
 * @param {Object} options - Search configuration options
 * @returns {Array} - Combined and deduplicated search results
 */
function SearchQuery(search, searchFrom, options = {}) {
  if (!search || !searchFrom?.length) return [];

  // Normalize search terms
  const searchTerms = Array.isArray(search)
    ? search.filter(Boolean).map((term) => term.toString().trim())
    : [search.toString().trim()];

  if (!searchTerms.length) return [];

  // Perform search for each term
  const allResults = searchTerms.flatMap((term) => {
    return performSearch(term, searchFrom, options);
  });

  // Deduplicate results based on UID or other unique identifier
  const resultsMap = new Map();

  allResults.forEach((item) => {
    const key = item.uid || JSON.stringify(item);
    const existing = resultsMap.get(key);

    if (!existing || (existing.searchScore || 0) < (item.searchScore || 0)) {
      resultsMap.set(key, item);
    }
  });

  // Sort by highest search score
  return Array.from(resultsMap.values()).sort(
    (a, b) => (b.searchScore || 0) - (a.searchScore || 0)
  );
}

module.exports = {
  AddToDatabase,
  getProfileData,
  processUserRecord,
  isNotAdmin,
  getUsersDataArr,
  getUsersBasedOnId,
  SearchQuery,
};
