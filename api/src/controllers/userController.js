const { Timestamp } = require('firebase-admin/firestore');
const { auth } = require('../config/firebase');
const { VALID_ROLES, ADMIN_ROLE } = require('../utils/constants');
const { uid } = require('uid');
const { AddToDatabase } = require('../utils/functions');

exports.createUserRole = async (req, res, next) => {
  const { body, user } = req;
  const isAdminClaim = String(user.email).includes(process.env.ADMIN_EMAIL);

  if (VALID_ROLES.includes(body.role)) {
    try {
      const customUserClaimsObj = { role: body.role, admin: false };
      let databaseResponse = '';
      if (isAdminClaim) {
        customUserClaimsObj.admin = true;
        customUserClaimsObj.role = ADMIN_ROLE;
      } else {
        const data = {
          uid: user.uid,
          isProfileComplete: false,
          createdAt: Timestamp.now(),
        };
        data[`${body.role}_id`] = `${String(body.role).substring(0, 3)}_${uid(
          6
        )}`;

        databaseResponse = await AddToDatabase(data, body.role);
        databaseResponse = await databaseResponse?.data();
      }

      auth.setCustomUserClaims(user.uid, customUserClaimsObj);
      const displayName = `${body.firstName} ${body.lastName}`;
      auth.updateUser(user.uid, { displayName });

      const responseObj = {
        displayName,
        ...customUserClaimsObj,
        createdAt: Timestamp.now()?.toDate()?.toDateString(),
        profile: { ...databaseResponse },
      };
      responseObj.profile.createdAt = responseObj.profile.createdAt
        ?.toDate()
        .toDateString();
      res.status(201).send(responseObj);
    } catch (error) {
      next(error);
    }
  } else {
    res.status(422).send({
      error: 'Invalid Role Selection',
      message: 'Please select proper role to continue',
    });
  }
};
