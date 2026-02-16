const express = require('express');
const router = express.Router();
const authController = require('../../controllers/shared/admin.controller');
const { isAdmin } = require('../../middleware/auth');
const { verifyAcessToken } = require('../../middleware/jwtHelper');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);

router.get('/profile', isAdmin, authController.getProfile);
router.put('/profile', isAdmin, authController.updateProfile);
router.post('/change-password', isAdmin, authController.changePassword);
router.post('/logout', isAdmin, authController.logout);

router.get('/profile-jwt', verifyAcessToken, authController.getProfile);

module.exports = router;
