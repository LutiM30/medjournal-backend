const createApp = require('./app');
const PORT = process.env.PORT || 5000;

const app = createApp();

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
