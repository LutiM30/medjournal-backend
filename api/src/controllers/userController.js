const { Timestamp } = require('firebase-admin/firestore');
const { auth, admin } = require('../config/firebase');
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
