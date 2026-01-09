const mongoose = require('mongoose');
const { Schema } = mongoose;
const bcrypt = require('bcrypt');
const { adminAuthSchema } = require('../../middleware/authValidator');

const adminSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (email) {
          // Use Joi validation for email
          const { error } = adminAuthSchema.extract('email').validate(email);
          return !error;
        },
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // Password won't be returned by default
    },
    name: {
      type: String,
      trim: true,
      default: function () {
        return this.email.split('@')[0]; // Default name from email
      },
    },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'editor', 'viewer'],
      default: 'admin',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      select: false,
    },
    profileImage: {
      type: String,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // Remove sensitive fields
        delete ret.password;
        delete ret.loginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.loginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
  }
);

// Indexes
adminSchema.index({ email: 1 }, { unique: true });
adminSchema.index({ role: 1 });
adminSchema.index({ isActive: 1 });
adminSchema.index({ createdAt: -1 });

// Pre-save middleware for validation
adminSchema.pre('save', async function () {
  try {
    // Validate with Joi if email or password is modified
    if (this.isModified('email') || this.isModified('password')) {
      const { error } = adminAuthSchema.validate(
        {
          email: this.email,
          password: this.isModified('password')
            ? this.password
            : 'dummyPass123',
        },
        { abortEarly: false }
      );

      if (error) {
        const validationErrors = error.details.map((detail) => detail.message);
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }
    }

    // updatedAt is automatically managed by timestamps: true
  } catch (error) {
    throw error;
  }
});

// Password hashing middleware
adminSchema.pre('save', async function () {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error;
  }
});

// Instance Methods
adminSchema.methods.isValidPassword = async function (password) {
  try {
    return await bcrypt.compare(password, this.password);
  } catch (error) {
    throw error;
  }
};

// Check if account is locked (compatible with your auth middleware)
adminSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
adminSchema.methods.incrementLoginAttempts = async function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return await this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  // Otherwise increment
  const updates = { $inc: { loginAttempts: 1 } };

  // Lock the account if we've reached max attempts
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours lock
  }

  return await this.updateOne(updates);
};

// Reset login attempts
adminSchema.methods.resetLoginAttempts = async function () {
  return await this.updateOne({
    $set: { lastLogin: Date.now() },
    $unset: { loginAttempts: 1, lockUntil: 1 },
  });
};

// Static Methods
adminSchema.statics.findByEmail = function (email) {
  return this.findOne({ email }).select('+password +loginAttempts +lockUntil');
};

adminSchema.statics.findActiveAdmins = function () {
  return this.find({ isActive: true });
};

// Virtuals
adminSchema.virtual('displayName').get(function () {
  return this.name || this.email.split('@')[0];
});

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
