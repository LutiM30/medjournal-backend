const { auth } = require('../config/firebase');

module.exports = async (req, res, next) => {
  try {
    console.log(req.headers);
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) throw new Error('No token provided');

    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.log({ error });

    res.status(401).json({ error: 'Unauthorized', message: 'Login' });
  }
};
