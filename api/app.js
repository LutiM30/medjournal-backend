const cors = require('cors');
const express = require('express');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const { errorHandler, authMiddleware } = require('./src/middleware');
const userRoutes = require('./src/routes/userRoutes');

const creteApp = () => {
  const app = express();

  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://medicaljournal.vercel.app',
  ];

  // Middleware
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.error(`Blocked by CORS: Origin ${origin} not allowed`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Routes
  app.use('/users', userRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
  });

  // 404 handler
  app.use((req, res) => {
    console.log(`404 - Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
      status: 'error',
      message: 'Route not found',
    });
  });

  // Error handling middleware
  app.use(errorHandler);

  return app;
};

module.exports = creteApp;
