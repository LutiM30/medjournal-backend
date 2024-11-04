const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController.js');
const authMiddleware = require('../middleware/authMiddleware.js');

router.post('/create-user', userController.signUp);
router.get('/get-users', userController.getUserData);
router.post('/get-all-users', authMiddleware, userController.getAllUsersData); // Retrieve all user data (requires authentication)

module.exports = router;
