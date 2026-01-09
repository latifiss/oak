const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const liveArticleSchema = new Schema({
  content_title: {
    type: String,
    required: true,
    trim: true,
  },
  isKey: {
    type: Boolean,
    required: true,
    default: false,
  },
  content_description: {
    type: String,
    required: true,
    trim: true,
  },
  content_detail: {
    type: String,
    required: true,
    trim: true,
  },
  content_image_url: {
    type: String,
    required: false,
  },
  content_published_at: {
    type: Date,
    default: Date.now,
  },
});

const articleSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: Schema.Types.Mixed,
      required: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    subcategory: [
      {
        type: String,
        trim: true,
      },
    ],
    tags: [
      {
        type: String,
      },
    ],
    isLive: {
      type: Boolean,
      required: true,
      default: false,
    },
    wasLive: {
      type: Boolean,
      required: true,
      default: false,
    },
    isBreaking: {
      type: Boolean,
      required: true,
      default: false,
    },
    isTopstory: {
      type: Boolean,
      required: true,
      default: false,
    },
    hasLivescore: {
      type: Boolean,
      required: true,
      default: false,
    },
    livescoreTag: {
      type: String,
      trim: true,
    },
    breakingExpiresAt: {
      type: Date,
    },
    topstoryExpiresAt: {
      type: Date,
    },
    isHeadline: {
      type: Boolean,
      required: true,
      default: false,
    },
    source_name: {
      type: String,
      required: true,
      trim: true,
      default: 'Ghana score',
    },
    meta_title: {
      type: String,
    },
    meta_description: {
      type: String,
    },
    creator: {
      type: String,
      default: 'Admin',
    },
    slug: {
      type: String,
      trim: true,
      unique: true,
    },
    image_url: {
      type: String,
      required: false,
    },
    published_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

articleSchema.pre('save', async function () {
  if (this.isModified('isBreaking') && this.isBreaking) {
    this.breakingExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  }
  if (this.isModified('isBreaking') && !this.isBreaking) {
    this.breakingExpiresAt = null;
  }
});

articleSchema.pre('save', async function () {
  if (this.isModified('isTopstory') && this.isTopstory) {
    this.topstoryExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  }
  if (this.isModified('isTopstory') && !this.isTopstory) {
    this.topstoryExpiresAt = null;
  }
});

articleSchema.pre('validate', async function () {
  if (this.hasLivescore && !this.livescoreTag) {
    this.invalidate(
      'livescoreTag',
      'livescoreTag is required when hasLivescore is true'
    );
  }
  if (!this.hasLivescore && this.livescoreTag) {
    this.livescoreTag = undefined;
  }
});

articleSchema.methods.createLiveArticle = function (data) {
  return new mongoose.Document(data, liveArticleSchema);
};

articleSchema.methods.validateLiveArticle = function (data) {
  const LiveArticle = mongoose.model('LiveArticle', liveArticleSchema);
  const liveArticle = new LiveArticle(data);
  return liveArticle.validateSync();
};

articleSchema.methods.createLiveArticleFromString = function (content) {
  return {
    content_title: this.title,
    content_description: this.description,
    content_detail: content,
    content_image_url: this.image_url,
    content_published_at: this.published_at,
    isKey: false,
  };
};

articleSchema.pre('validate', async function () {
  if (this.isLive) {
    if (typeof this.content === 'string') {
      this.content = [this.createLiveArticleFromString(this.content)];
    }
  } else {
    if (Array.isArray(this.content)) {
      this.content = this.content[0]?.content_detail || '';
    }
  }
});

articleSchema.pre('save', async function () {
  if (this.isModified('wasLive') && this.wasLive) {
    this.isLive = false;
  }
});

articleSchema.pre('save', async function () {
  if (this.isModified('title') && !this.slug) {
    this.slug = this.generateSlug(this.title);
  }
});

articleSchema.methods.isTopstoryExpired = function () {
  if (!this.isTopstory) return true;
  if (!this.topstoryExpiresAt) return false;
  return new Date() > this.topstoryExpiresAt;
};

articleSchema.statics.updateExpiredTopstories = async function () {
  const now = new Date();
  const result = await this.updateMany(
    {
      isTopstory: true,
      topstoryExpiresAt: { $lt: now },
    },
    {
      $set: { isTopstory: false },
      $unset: { topstoryExpiresAt: 1 },
    }
  );
  return result.modifiedCount;
};

articleSchema.statics.updateExpiredBreakingNews = async function () {
  const now = new Date();
  const result = await this.updateMany(
    {
      isBreaking: true,
      breakingExpiresAt: { $lt: now },
    },
    {
      $set: { isBreaking: false, breakingExpiresAt: null },
    }
  );
  return result.modifiedCount;
};

articleSchema.methods.generateMetaTitle = function (title) {
  if (!title) return '';
  const cleanedTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '');
  if (cleanedTitle.length <= 60) return cleanedTitle;
  return cleanedTitle.substring(0, 57).trim() + '...';
};

articleSchema.methods.generateMetaDescription = function (data) {
  if (data.description) {
    return data.description.substring(0, 155).trim();
  }
  return `${data.title || 'Feature'}. ${
    data.description || 'Read our detailed feature.'
  }`.substring(0, 155);
};

articleSchema.methods.generateSlug = function (title) {
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

const Article = mongoose.model('GhanascoreArticle', articleSchema);

module.exports = { Article, liveArticleSchema };
