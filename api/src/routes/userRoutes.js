const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController.js');
const authMiddleware = require('../middleware/authMiddleware.js');
const { updateUserAccount } = require('../controllers/updateUserAccount.js');

router.post('/create-user', userController.signUp);
router.get('/get-users', authMiddleware, userController.getUserData);
router.post('/get-all-users', authMiddleware, userController.getAllUsers); // Retrieve all user data (requires authentication)

/**
 * PUT route to update user accounts, accessible only to authorized users.
 * @name updateUserAccount
 * @route {PUT} /update-user-account
 * @middleware authMiddleware - Requires authentication middleware to check user permissions.
 * @controller updateUserAccount - Calls the updateUserAccount controller to handle the request.
 */
router.post('/update-user-account', authMiddleware, updateUserAccount); // Retrieve all user data (requires authentication)

router.post(
  '/update-photo-url',
  authMiddleware,
  userController.updateProfilePicture
); // Retrieve all user data (requires authentication)

module.exports = router;
