const { firestore } = require('../config/firebase');
const { MESSAGES, VALID_ROLES, ADMIN_ROLE } = require('./constants');

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

module.exports = {
  AddToDatabase,
  getProfileData,
  processUserRecord,
  isNotAdmin,
  getUsersDataArr,
  getUsersBasedOnId,
};
