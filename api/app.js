const cors = require('cors');
const express = require('express');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const { errorHandler, authMiddleware } = require('./src/middleware');
const userRoutes = require('./src/routes/userRoutes');

const creteApp = () => {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Routes
  app.use('/users', userRoutes);

  // Error handling middleware
  app.use(errorHandler);

  return app;
};

module.exports = creteApp;
