const admin = require('firebase-admin');

exports.signup = async (req, res, next) => {
  try {
    const { email, password, } = req.body;
    const userRecord = await admin.auth().createUser({ email, password });
    res.status(201).json({ userId: userRecord.uid });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  res.status(200).json({ message: 'hello' });
  // Implement login logic
};
