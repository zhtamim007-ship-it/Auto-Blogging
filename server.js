// server.js
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const methodOverride = require('method-override');
const morgan = require('morgan'); // For logging requests

// Load environment variables
dotenv.config();

// Import database connection
const { connectDB } = require('./db');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const apiKeysRoutes = require('./routes/apiKeys');

// Import logging utility
const { logExecution } = require('./services/apiService');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Database
connectDB();

// Middleware
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
app.use(methodOverride('_method')); // Allows using PUT, DELETE etc. in forms
app.use(morgan('dev')); // HTTP request logger middleware
app.set('view engine', 'ejs'); // Set EJS as templating engine
app.set('views', path.join(__dirname, 'views')); // Set views directory

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.redirect('/admin'); // Default to admin dashboard
});

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/api-keys', apiKeysRoutes);

// Catch-all for 404 errors
app.use((req, res) => {
    const errorMsg = \`404 - Not Found: \${req.originalUrl}\`;
    console.error(errorMsg);
    logExecution('FAILED', 'Route Not Found', errorMsg, null, { path: req.originalUrl });
    res.status(404).send('Page Not Found.');
});

// Global error handler
app.use((err, req, res, next) => {
    const errorMsg = \`Internal Server Error: \${err.message}\`;
    console.error(errorMsg, err.stack);
    logExecution('FAILED', 'Global Error Handler', errorMsg, null, { stack: err.stack });
    // In a production environment, you might want to send a more generic error message
    // and use a dedicated error reporting service.
    res.status(err.status || 500).send(errorMsg);
});

// Start the server
app.listen(PORT, () => {
    console.log(\`Server running on http://localhost:\${PORT}\`);
    logExecution('SUCCESS', 'Server Start', \`Server started on port \${PORT}\`);
});