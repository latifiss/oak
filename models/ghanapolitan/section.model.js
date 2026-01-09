const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const sectionSchema = new Schema(
  {
    section_name: {
      type: String,
      required: true,
      trim: true,
    },
    section_code: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    section_slug: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    section_description: {
      type: String,
      trim: true,
    },
    isSectionImportant: {
      type: Boolean,
      default: false,
    },
    expires_at: {
      type: Date,
      default: null,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    category: {
      type: String,
      trim: true,
    },
    subcategory: [
      {
        type: String,
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    meta_title: {
      type: String,
      trim: true,
    },
    meta_description: {
      type: String,
      trim: true,
    },
    section_image_url: {
      type: String,
    },
    section_color: {
      type: String,
      trim: true,
      default: '#000000',
    },
    section_background_color: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      default: 'Admin',
    },
    updatedBy: {
      type: String,
    },
    articles_count: {
      type: Number,
      default: 0,
    },
    featured_articles: [
      {
        type: Schema.Types.ObjectId,
        ref: 'GhanapolitanArticle',
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Add indexes for better query performance
sectionSchema.index({ section_slug: 1 });
sectionSchema.index({ section_code: 1 });
sectionSchema.index({ isActive: 1 });
sectionSchema.index({ displayOrder: 1 });
sectionSchema.index({ isSectionImportant: 1 });
sectionSchema.index({ tags: 1 });
sectionSchema.index({ expires_at: 1 });

// Pre-save middleware
sectionSchema.pre('save', async function () {
  // Generate slug from section_name if not provided
  if (this.isModified('section_name') && !this.section_slug) {
    this.section_slug = this.generateSlug(this.section_name);
  }

  // Generate meta_title from section_name if not provided
  if (!this.meta_title && this.section_name) {
    this.meta_title = this.generateMetaTitle(this.section_name);
  }

  // Generate meta_description from section_description or section_name if not provided
  if (!this.meta_description) {
    if (this.section_description) {
      this.meta_description = this.generateMetaDescription(
        this.section_description
      );
    } else if (this.section_name) {
      this.meta_description = this.generateMetaDescription(this.section_name);
    }
  }

  // Check for unique section_slug
  if (this.isModified('section_slug')) {
    const existingSection = await mongoose.models.Section?.findOne({
      section_slug: this.section_slug,
      _id: { $ne: this._id },
    });

    if (existingSection) {
      throw new Error('Section slug already exists');
    }
  }

  // Check for unique section_code
  if (this.isModified('section_code')) {
    const existingSection = await mongoose.models.Section?.findOne({
      section_code: this.section_code,
      _id: { $ne: this._id },
    });

    if (existingSection) {
      throw new Error('Section code already exists');
    }
  }

  // Update isActive based on expires_at
  if (this.expires_at) {
    const now = new Date();
    this.isActive = this.expires_at > now;
  } else {
    this.isActive = true;
  }
});

// Instance method to generate meta title
sectionSchema.methods.generateMetaTitle = function (title) {
  if (!title) return '';
  const cleanedTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '');
  if (cleanedTitle.length <= 60) return cleanedTitle;
  return cleanedTitle.substring(0, 57).trim() + '...';
};

// Instance method to generate meta description
sectionSchema.methods.generateMetaDescription = function (text) {
  if (!text) return '';
  const plainText = text.replace(/<[^>]*>/g, '');
  if (plainText.length <= 155) return plainText;
  return plainText.substring(0, 152).trim() + '...';
};

// Instance method to generate slug
sectionSchema.methods.generateSlug = function (title) {
  if (!title) return '';
  return title
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

// Instance method to add tags
sectionSchema.methods.addTag = function (tag) {
  if (!this.tags.includes(tag)) {
    this.tags.push(tag);
  }
  return this.tags;
};

// Instance method to remove tag
sectionSchema.methods.removeTag = function (tag) {
  this.tags = this.tags.filter((t) => t !== tag);
  return this.tags;
};

// Instance method to add subcategory
sectionSchema.methods.addSubcategory = function (subcategory) {
  if (!this.subcategory.includes(subcategory)) {
    this.subcategory.push(subcategory);
  }
  return this.subcategory;
};

// Instance method to remove subcategory
sectionSchema.methods.removeSubcategory = function (subcategory) {
  this.subcategory = this.subcategory.filter((s) => s !== subcategory);
  return this.subcategory;
};

// Instance method to increment articles count
sectionSchema.methods.incrementArticlesCount = function () {
  this.articles_count += 1;
  return this.articles_count;
};

// Instance method to decrement articles count
sectionSchema.methods.decrementArticlesCount = function () {
  this.articles_count = Math.max(0, this.articles_count - 1);
  return this.articles_count;
};

// Instance method to add featured article
sectionSchema.methods.addFeaturedArticle = function (articleId) {
  if (!this.featured_articles.includes(articleId)) {
    this.featured_articles.push(articleId);
    // Keep only the latest 10 featured articles
    if (this.featured_articles.length > 10) {
      this.featured_articles = this.featured_articles.slice(-10);
    }
  }
  return this.featured_articles;
};

// Instance method to remove featured article
sectionSchema.methods.removeFeaturedArticle = function (articleId) {
  this.featured_articles = this.featured_articles.filter(
    (id) => id.toString() !== articleId.toString()
  );
  return this.featured_articles;
};

// Instance method to check if section is expired
sectionSchema.methods.isExpired = function () {
  if (!this.expires_at) return false;
  return this.expires_at < new Date();
};

// Instance method to extend expiration
sectionSchema.methods.extendExpiration = function (days) {
  if (!this.expires_at) {
    this.expires_at = new Date();
  }
  this.expires_at.setDate(this.expires_at.getDate() + days);
  return this.expires_at;
};

// Instance method to set expiration
sectionSchema.methods.setExpiration = function (date) {
  this.expires_at = date;
  return this.expires_at;
};

// Static method to update expired sections
sectionSchema.statics.updateExpiredSections = async function () {
  const now = new Date();
  return this.updateMany(
    { expires_at: { $ne: null, $lt: now }, isActive: true },
    { $set: { isActive: false } }
  );
};

// Static method to find by slug
sectionSchema.statics.findBySlug = function (slug) {
  return this.findOne({ section_slug: slug, isActive: true });
};

// Static method to find by code
sectionSchema.statics.findByCode = function (code) {
  return this.findOne({ section_code: code, isActive: true });
};

// Static method to find important sections
sectionSchema.statics.findImportantSections = function () {
  return this.find({ isSectionImportant: true, isActive: true }).sort({
    displayOrder: 1,
    section_name: 1,
  });
};

// Static method to find all active sections with sorting
sectionSchema.statics.findAllActive = function () {
  return this.find({ isActive: true }).sort({
    displayOrder: 1,
    section_name: 1,
  });
};

// Static method to find sections expiring soon
sectionSchema.statics.findExpiringSoon = function (days = 7) {
  const soon = new Date();
  soon.setDate(soon.getDate() + days);

  return this.find({
    expires_at: { $ne: null, $lte: soon, $gt: new Date() },
    isActive: true,
  }).sort({
    expires_at: 1,
    section_name: 1,
  });
};

// Static method to find sections by tags
sectionSchema.statics.findByTags = function (tags) {
  return this.find({
    tags: { $in: tags },
    isActive: true,
  }).sort({ displayOrder: 1, section_name: 1 });
};

const Section = mongoose.model('Section', sectionSchema);

module.exports = Section;
