const { auth } = require('../config/firebase');
const {
  processUserRecord,
  isNotAdmin,
  SearchQuery,
} = require('../utils/functions.js');

const pageTokensMap = new Map();
const searchResultsCache = new Map();

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

module.exports = async (req, res, next) => {
  const { body } = req;
  const { search } = body;
  const page = parseInt(body.page) || 0;
  const PAGE_SIZE = 10;

  try {
    // Verify admin access
    isNotAdmin(req, res);
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
