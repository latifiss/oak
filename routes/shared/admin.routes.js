const express = require('express');
const router = express.Router();
const authController = require('../../controllers/shared/admin.controller');
const { isAdmin } = require('../../middleware/auth');
const { verifyAcessToken } = require('../../middleware/jwtHelper');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);

// Protected routes (using your existing auth middleware)
router.get('/profile', isAdmin, authController.getProfile);
router.put('/profile', isAdmin, authController.updateProfile);
router.post('/change-password', isAdmin, authController.changePassword);
router.post('/logout', isAdmin, authController.logout);

// Alternative protected routes (using JWT helper)
router.get('/profile-jwt', verifyAcessToken, authController.getProfile);

module.exports = router;
