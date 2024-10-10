const { firestore } = require('../config/firebase');
const { MESSAGES, VALID_ROLES } = require('./constants');

const AddToDatabase = async (data, role) => {
  if (!VALID_ROLES.includes(role)) {
    throw MESSAGES.InvalidUserRole;
  } else {
    try {
      const collectionRef = firestore.collection(role);
      const docRef = collectionRef.doc(data.uid);
      console.log(role, data.uid, docRef.path);

      await docRef.set(data);
      return await docRef.get();
    } catch (error) {
      console.error('Error AddToDatabase: ', error);
      throw error;
    }
  }
};

module.exports = { AddToDatabase };
