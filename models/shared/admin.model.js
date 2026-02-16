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
          const { error } = adminAuthSchema.extract('email').validate(email);
          return !error;
        },
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
    },
    name: {
      type: String,
      trim: true,
      default: function () {
        return this.email.split('@')[0];
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
  },
);

adminSchema.index({ email: 1 }, { unique: true });
adminSchema.index({ role: 1 });
adminSchema.index({ isActive: 1 });
adminSchema.index({ createdAt: -1 });

adminSchema.pre('save', async function () {
  try {
    if (this.isModified('email') || this.isModified('password')) {
      const { error } = adminAuthSchema.validate(
        {
          email: this.email,
          password: this.isModified('password')
            ? this.password
            : 'dummyPass123',
        },
        { abortEarly: false },
      );

      if (error) {
        const validationErrors = error.details.map((detail) => detail.message);
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }
    }
  } catch (error) {
    throw error;
  }
});

adminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error;
  }
});

adminSchema.methods.isValidPassword = async function (password) {
  try {
    return await bcrypt.compare(password, this.password);
  } catch (error) {
    throw error;
  }
};

adminSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

adminSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return await this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }

  return await this.updateOne(updates);
};

adminSchema.methods.resetLoginAttempts = async function () {
  return await this.updateOne({
    $set: { lastLogin: Date.now() },
    $unset: { loginAttempts: 1, lockUntil: 1 },
  });
};

adminSchema.statics.findByEmail = function (email) {
  return this.findOne({ email }).select('+password +loginAttempts +lockUntil');
};

adminSchema.statics.findActiveAdmins = function () {
  return this.find({ isActive: true });
};

adminSchema.virtual('displayName').get(function () {
  return this.name || this.email.split('@')[0];
});

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
