const Joi = require('joi');

// Keep your existing schemas
const adminAuthSchema = Joi.object({
  email: Joi.string()
    .email()
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .required()
    .messages({
      'string.email':
        'Email must be a valid email address (e.g., example@domain.com)',
      'string.empty': 'Email is required',
      'any.required': 'Email is a required field',
    }),

  password: Joi.string().min(8).max(100).required().messages({
    'string.base': 'Password must be a string',
    'string.empty': 'Password is required',
    'string.min': 'Password should have at least 8 characters',
    'string.max': 'Password should not exceed 100 characters',
    'any.required': 'Password is a required field',
  }),
});

// ADD THESE NEW SCHEMAS
const adminRegisterSchema = Joi.object({
  email: Joi.string()
    .email()
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .required()
    .messages({
      'string.email':
        'Email must be a valid email address (e.g., example@domain.com)',
      'string.empty': 'Email is required',
      'any.required': 'Email is a required field',
    }),

  password: Joi.string().min(8).max(100).required().messages({
    'string.base': 'Password must be a string',
    'string.empty': 'Password is required',
    'string.min': 'Password should have at least 8 characters',
    'string.max': 'Password should not exceed 100 characters',
    'any.required': 'Password is a required field',
  }),

  name: Joi.string().min(2).max(50).optional().messages({
    'string.base': 'Name must be a string',
    'string.min': 'Name should have at least 2 characters',
    'string.max': 'Name should not exceed 50 characters',
  }),

  role: Joi.string()
    .valid('super_admin', 'admin', 'editor', 'viewer')
    .default('admin')
    .optional()
    .messages({
      'any.only': 'Role must be one of: super_admin, admin, editor, viewer',
    }),

  profileImage: Joi.string().uri().optional().messages({
    'string.uri': 'Profile image must be a valid URL',
  }),
}).options({ stripUnknown: true });

const adminLoginSchema = Joi.object({
  email: Joi.string()
    .email()
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .required()
    .messages({
      'string.email':
        'Email must be a valid email address (e.g., example@domain.com)',
      'string.empty': 'Email is required',
      'any.required': 'Email is a required field',
    }),

  password: Joi.string().min(8).max(100).required().messages({
    'string.base': 'Password must be a string',
    'string.empty': 'Password is required',
    'string.min': 'Password should have at least 8 characters',
    'string.max': 'Password should not exceed 100 characters',
    'any.required': 'Password is a required field',
  }),
});

const userAuthSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.base': 'Name must be a string',
    'string.empty': 'Name is required',
    'string.min': 'Name should have at least 2 characters',
    'string.max': 'Name should not exceed 50 characters',
    'any.required': 'Name is a required field',
  }),
  email: Joi.string()
    .email()
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .required()
    .messages({
      'string.pattern.base':
        'Email must be a valid email address (e.g., example@domain.com)',
    }),
  password: Joi.string().min(8).max(100).required().messages({
    'string.base': 'Password must be a string',
    'string.empty': 'Password is required',
    'string.min': 'Password should have at least 8 characters',
    'string.max': 'Password should not exceed 100 characters',
    'any.required': 'Password is a required field',
  }),
  phone: Joi.string()
    .pattern(/^(?:\+233|0)[245][0-9]{8}$/)
    .required()
    .messages({
      'string.pattern.base':
        'Phone number must be a valid Ghanaian number (e.g., 0241234567 or +233241234567)',
    }),
});

module.exports = {
  userAuthSchema,
  adminAuthSchema,
  adminRegisterSchema, // ADD THIS
  adminLoginSchema, // ADD THIS
};
