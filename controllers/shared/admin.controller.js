const Admin = require('../../models/shared/admin.model');
// CORRECTED IMPORT: Import both schemas from your validator
const {
  adminRegisterSchema, // For registration
  adminLoginSchema, // For login
} = require('../../middleware/authValidator');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../../middleware/jwtHelper');
const generateAuthToken = require('../../middleware/generateAuthToken');

exports.register = async (req, res) => {
  try {
    // Validate with the REGISTER schema (allows name, role, etc.)
    const { error, value } = adminRegisterSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true, // This removes any fields not in schema
    });

    if (error) {
      const validationErrors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    // value now contains only validated fields
    const { email, password, name, role, profileImage } = value;

    // Check if admin exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        message: 'Admin with this email already exists',
      });
    }

    // Create admin
    const admin = new Admin({
      email,
      password,
      name: name || email.split('@')[0], // Default to email username if no name
      role: role || 'admin',
      profileImage: profileImage || '',
    });

    await admin.save();

    // Generate tokens
    const accessToken = await signAccessToken(admin._id.toString());
    const refreshToken = await signRefreshToken(admin._id.toString());
    const authToken = generateAuthToken({
      _id: admin._id,
      name: admin.name,
      email: admin.email,
    });

    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      data: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        profileImage: admin.profileImage,
        createdAt: admin.createdAt,
        tokens: {
          accessToken,
          refreshToken,
          authToken,
        },
      },
    });
  } catch (error) {
    console.error('Registration error:', error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists',
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Login Admin
exports.login = async (req, res) => {
  try {
    // Validate with the LOGIN schema (only email and password)
    const { error, value } = adminLoginSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      const validationErrors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    const { email, password } = value;

    // Find admin with password and locked fields
    const admin = await Admin.findOne({ email }).select(
      '+password +loginAttempts +lockUntil'
    );

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if account is locked
    if (admin.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is locked. Try again later.',
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated',
      });
    }

    // Check password
    const isPasswordValid = await admin.isValidPassword(password);

    if (!isPasswordValid) {
      // Increment login attempts
      await admin.incrementLoginAttempts();

      const attemptsLeft = 5 - (admin.loginAttempts + 1);

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        attemptsLeft: attemptsLeft > 0 ? attemptsLeft : 0,
      });
    }

    // Reset login attempts
    await admin.resetLoginAttempts();

    // Update last login
    admin.lastLogin = Date.now();
    await admin.save({ validateBeforeSave: false });

    // Generate tokens
    const accessToken = await signAccessToken(admin._id.toString());
    const refreshToken = await signRefreshToken(admin._id.toString());
    const authToken = generateAuthToken({
      _id: admin._id,
      name: admin.name,
      email: admin.email,
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        profileImage: admin.profileImage,
        lastLogin: admin.lastLogin,
        tokens: {
          accessToken,
          refreshToken,
          authToken,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
    });
  }
};

// Refresh Token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const adminId = await verifyRefreshToken(refreshToken);

    // Generate new tokens
    const newAccessToken = await signAccessToken(adminId);
    const newRefreshToken = await signRefreshToken(adminId);

    // Get admin data for auth token
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    const authToken = generateAuthToken({
      _id: admin._id,
      name: admin.name || admin.email.split('@')[0],
      email: admin.email,
    });

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        authToken,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
    });
  }
};

// Get Profile
exports.getProfile = async (req, res) => {
  try {
    // Your auth middleware adds admin to req
    const admin = await Admin.findById(req.admin._id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching profile',
    });
  }
};

// Update Profile
exports.updateProfile = async (req, res) => {
  try {
    const updates = {};

    // Allowed fields to update
    if (req.body.name) updates.name = req.body.name;
    if (req.body.profileImage) updates.profileImage = req.body.profileImage;

    // Don't allow email or role updates through this endpoint
    if (req.body.email || req.body.role) {
      return res.status(400).json({
        success: false,
        message: 'Email and role cannot be updated through this endpoint',
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: admin,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating profile',
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  // In JWT system, logout is client-side
  // You could implement token blacklisting here if needed
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};

// Change Password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current and new passwords are required',
      });
    }

    // For password validation, you can either use adminLoginSchema or create a separate password schema
    // Since adminLoginSchema validates password, we can use it
    const passwordValidation = adminLoginSchema.extract('password');
    const { error } = passwordValidation.validate(newPassword);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    // Get admin with password
    const admin = await Admin.findById(req.admin._id).select('+password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await admin.isValidPassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error changing password',
    });
  }
};

// Get All Admins (for super admin only)
exports.getAllAdmins = async (req, res) => {
  try {
    // Check if requester is super admin
    const requester = await Admin.findById(req.admin._id);
    if (requester.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can view all admins',
      });
    }

    const admins = await Admin.find({}).select(
      '-password -loginAttempts -lockUntil'
    );

    res.status(200).json({
      success: true,
      count: admins.length,
      data: admins,
    });
  } catch (error) {
    console.error('Get all admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching admins',
    });
  }
};

// Update Admin Status (activate/deactivate)
exports.updateAdminStatus = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { isActive } = req.body;

    // Check if requester is super admin
    const requester = await Admin.findById(req.admin._id);
    if (requester.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can update admin status',
      });
    }

    // Prevent deactivating self
    if (adminId === requester._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account',
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    const statusMessage = isActive ? 'activated' : 'deactivated';

    res.status(200).json({
      success: true,
      message: `Admin ${statusMessage} successfully`,
      data: admin,
    });
  } catch (error) {
    console.error('Update admin status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating admin status',
    });
  }
};
