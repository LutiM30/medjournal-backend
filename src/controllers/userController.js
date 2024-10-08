const { Timestamp } = require('firebase-admin/firestore');
const { auth, firestore } = require('../config/firebase');
const { VALID_ROLES, ADMIN_ROLE, COLLECTIONS } = require('../utils/constants');

exports.createUserRole = async (req, res, next) => {
  try {
    const { body, user } = req;

    if (String(user.email).includes(process.env.ADMIN_EMAIL)) {
      delete body.role;
      auth.setCustomUserClaims(user.uid, { role: ADMIN_ROLE, admin: true });

      const adminRef = firestore.collection(COLLECTIONS.ADMINS).doc(user.uid);
      const userRef = firestore.collection(COLLECTIONS.USERS).doc(user.uid);

      const toAdminFirebase = {
        uid: user.uid,
        email: user.email,
        createdAt: Timestamp.now(),
      };
      const toUserFirebase = {
        uid: user.uid,
        email: user.email,
        createdAt: Timestamp.now(),
      };

      await adminRef.set(toAdminFirebase);
      await userRef.set(toUserFirebase);
      toUserFirebase.createdAt = toUserFirebase.createdAt
        ?.toDate()
        ?.toDateString();

      res.status(201).send(toUserFirebase);
    } else if (VALID_ROLES.includes(body.role)) {
      auth.setCustomUserClaims(user.uid, { role: body.role, admin: false });
      res.status(201).send({ uid: user.uid, role: body.role });
    } else {
      res.status(422).send({
        error: 'Invalid Role Selection',
        message: 'Please select proper role to continue',
      });
    }
  } catch (error) {
    next(error);
  }
};
