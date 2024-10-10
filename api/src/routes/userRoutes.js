const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController.js');

router.post('/create-user', userController.signUp);

module.exports = router;
