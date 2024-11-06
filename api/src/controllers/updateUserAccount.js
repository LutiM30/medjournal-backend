const { auth, firestore } = require('../config/firebase');
const { COLLECTIONS } = require('../utils/constants');
const { isNotAdmin } = require('./userController');

/**
 * Deletes users from both Firestore collections and Firebase Authentication.
 * @async
 * @function deleteUser
 * @param {Array<string>} ids - An array of Firebase Auth UIDs representing the users to delete.
 * @param {Object} res - Express response object for sending a response back to the client.
 * @returns {Promise<void>}
 */
const deleteUser = async (ids, res) => {
  try {
    // Firestore Batch Deletes
    const deleteDocsPromises = Object.values(COLLECTIONS).map(
      async (collection) => {
        const collectionRef = firestore.collection(collection);
        const batches = [];

        for (let i = 0; i < ids.length; i += 500) {
          const batch = firestore.batch();
          const batchIds = ids.slice(i, i + 500);

          batchIds.forEach((uid) => {
            const docRef = collectionRef.doc(uid);
            batch.delete(docRef);
          });

          batches.push(batch.commit()); // Commit the batch
        }

        await Promise.all(batches); // Commit all batches in parallel
      }
    );

    // Run Firestore and Firebase Authentication deletions in parallel
    await Promise.all([
      ...deleteDocsPromises,
      auth.deleteUsers(ids), // Firebase Auth deletion
    ]);

    res.status(200).send({ message: 'Users deleted successfully' });
  } catch (error) {
    console.error('Error deleting users:', error);
    res.status(500).send({ error: 'Error deleting users' });
  }
};

/**
 * Disables or enables user accounts based on the provided IDs.
 * @async
 * @function disableEnable
 * @param {boolean} [enable=false] - Determines whether to enable or disable user accounts. If true, accounts are enabled; if false, accounts are disabled.
 * @param {Array<string>} ids - An array of Firebase Auth UIDs representing the users to enable or disable.
 * @param {Object} res - Express response object to send feedback to the client.
 * @returns {Promise<void>}
 */
const disableEnable = async (enable = false, ids = [], res) => {
  try {
    // Update users' disabled status in parallel while preserving other data
    await Promise.all(
      ids.map(async (uid) => {
        // First get the current user data
        const currentUser = await auth.getUser(uid);

        // Merge the disabled status with existing user data
        const updatedData = {
          ...currentUser,
          disabled: !enable,
        };

        // Remove metadata fields that can't be updated
        delete updatedData.metadata;
        delete updatedData.tokensValidAfterTime;
        delete updatedData.providerData;

        return auth.updateUser(uid, updatedData);
      })
    );

    // Send a success response back to the client
    res.status(200).send({
      message: `Users successfully ${enable ? 'enabled' : 'disabled'}.`,
      updatedUserIds: ids,
    });
  } catch (error) {
    console.error(`Error ${enable ? 'enabling' : 'disabling'} users:`, error);
    res.status(500).send({
      error: `Error ${enable ? 'enabling' : 'disabling'} users.`,
      details: error.message,
    });
  }
};

/**
 * Updates the verified status of users in parallel based on provided IDs.
 * @async
 * @function verifyFalsify
 * @param {boolean} [verify=false] - Boolean flag to verify or falsify users. If true, users are verified; if false, they are unverified.
 * @param {Array<string>} ids - An array of Firebase Auth UIDs representing the users to Verify mainly Doctors.
 * @param {Object} res - Express response object for sending feedback to the client.
 * @returns {Promise<void>}
 */
const verifyFalsify = async (verify = false, ids, res) => {
  try {
    // Update users' verified status in parallel while preserving existing claims
    await Promise.all(
      ids.map(async (uid) => {
        // First get the current custom claims
        const { customClaims } = await auth.getUser(uid);

        // Merge the verified status with existing claims
        const updatedClaims = {
          ...customClaims,
          verified: verify,
        };

        return auth.setCustomUserClaims(uid, updatedClaims);
      })
    );

    // Send a success response back to the client
    res.status(200).send({
      message: `Users successfully ${verify ? 'verified' : 'unverified'}.`,
      updatedUserIds: ids,
    });
  } catch (error) {
    console.error(`Error while verifying users.`, error);
    res.status(500).send({
      error: `Error while verifying users.`,
      details: error.message,
    });
  }
};

/**
 * USER_ACTIONS object stores the actions available for user accounts,
 * mapping each action to its corresponding function.
 * @constant
 * @type {Object<string, Function>}
 */
const USER_ACTIONS = {
  delete: deleteUser,
  enable: async (ids, res) => await disableEnable(true, ids, res),
  disable: async (ids, res) => await disableEnable(false, ids, res),
  verify: async (ids, res) => await verifyFalsify(true, ids, res),
  falsify: async (ids, res) => await verifyFalsify(false, ids, res),
};

/**
 * Main controller function to update user accounts based on specified action.
 * @async
 * @function updateUserAccount
 * @param {Object} req - Express request object containing `ids` (array of UIDs) and `action` (operation to perform) in `req.body`.
 * @param {Object} res - Express response object to send feedback to the client.
 * @param {Function} next - Express middleware next function for passing control.
 * @returns {Promise<void>}
 */
exports.updateUserAccount = async (req, res, next) => {
  const { body } = req;
  const { ids, action } = body;

  if (!USER_ACTIONS.hasOwnProperty(action)) {
    res.status(422).send({
      error: 'Invalid action Selection',
      message: `Please select proper action to continue, correct actions are ${Object.keys(
        USER_ACTIONS
      ).join(', ')}`,
    });
  } else {
    isNotAdmin(req, res);

    USER_ACTIONS[action](ids, res);
  }
};
