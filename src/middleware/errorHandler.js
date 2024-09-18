module.exports = (err, req, res, next) => {
  console.error(err.stack);

  // Default error status and message
  let status = 500;
  let message = 'Something went wrong!';

  // Check if it's a known error type
  if (err.name === 'ValidationError') {
    status = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized access';
  }

  // In development, send the full error message
  // In production, send a generic message
  const errorResponse = {
    error: process.env.NODE_ENV === 'development' ? err.message : message,
  };

  // Optionally include the stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  res.status(status).json(errorResponse);
};
