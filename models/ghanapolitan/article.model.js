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

const commentSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 30,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    upvotes: {
      type: Number,
      default: 0,
    },
    downvotes: {
      type: Number,
      default: 0,
    },
    upvotedBy: [
      {
        type: String,
      },
    ],
    downvotedBy: [
      {
        type: String,
      },
    ],
    replies: [
      {
        username: {
          type: String,
          required: true,
          trim: true,
          minlength: 2,
          maxlength: 30,
        },
        content: {
          type: String,
          required: true,
          trim: true,
          maxlength: 500,
        },
        isEdited: {
          type: Boolean,
          default: false,
        },
        editedAt: {
          type: Date,
        },
        upvotes: {
          type: Number,
          default: 0,
        },
        downvotes: {
          type: Number,
          default: 0,
        },
        upvotedBy: [
          {
            type: String,
          },
        ],
        downvotedBy: [
          {
            type: String,
          },
        ],
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

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
    section_id: {
      type: String,
    },
    section_name: {
      type: String,
    },
    section_code: {
      type: String,
    },
    section_slug: {
      type: String,
    },
    has_section: {
      type: Boolean,
      default: false,
    },
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
    breakingExpiresAt: {
      type: Date,
    },
    isHeadline: {
      type: Boolean,
      required: true,
      default: false,
    },
    comments: [commentSchema],
    source_name: {
      type: String,
      required: true,
      trim: true,
      default: 'Ghanapolitan',
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

articleSchema.index({ 'comments.createdAt': -1 });
articleSchema.index({ 'comments.upvotes': -1 });
articleSchema.index({ 'comments.downvotes': 1 });
articleSchema.index({ section_id: 1 });
articleSchema.index({ section_slug: 1 });
articleSchema.index({ has_section: 1 });
articleSchema.index({ category: 1, has_section: 1 });

articleSchema.pre('save', async function () {
  if (this.isLive) {
    this.comments = [];
  }

  if (this.isModified('isBreaking') && this.isBreaking) {
    this.breakingExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  }
  if (this.isModified('isBreaking') && !this.isBreaking) {
    this.breakingExpiresAt = null;
  }

  if (this.isModified('section_name')) {
    this.has_section = !!this.section_name && this.section_name.trim() !== '';
  }

  if (
    !this.has_section &&
    this.section_name &&
    this.section_name.trim() !== ''
  ) {
    this.has_section = true;
  }

  if (
    this.section_name &&
    this.section_name.trim() !== '' &&
    !this.has_section
  ) {
    this.has_section = true;
  }

  if (!this.section_name || this.section_name.trim() === '') {
    this.has_section = false;
    this.section_id = null;
    this.section_code = null;
    this.section_slug = null;
  }

  // CRITICAL FIX: Generate slug only when title is modified AND slug doesn't exist
  if (this.isModified('title') && !this.slug) {
    this.slug = this.generateSlug(this.title);
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

  // Generate base slug from title
  const baseSlug = title
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  // Add timestamp for uniqueness (last 6 digits of timestamp)
  const timestamp = Date.now().toString().slice(-6);

  // Combine base slug with timestamp
  return `${baseSlug}-${timestamp}`;
};

articleSchema.methods.addComment = function (username, content) {
  if (this.isLive) {
    throw new Error('Live articles cannot have comments');
  }

  const newComment = {
    username: username,
    content: content,
    upvotes: 0,
    downvotes: 0,
    upvotedBy: [],
    downvotedBy: [],
    replies: [],
  };

  this.comments.push(newComment);
  return this.comments[this.comments.length - 1];
};

articleSchema.methods.addReply = function (commentId, username, content) {
  if (this.isLive) {
    throw new Error('Live articles cannot have comments or replies');
  }

  const comment = this.comments.id(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const newReply = {
    username: username,
    content: content,
    upvotes: 0,
    downvotes: 0,
    upvotedBy: [],
    downvotedBy: [],
  };

  comment.replies.push(newReply);
  return comment.replies[comment.replies.length - 1];
};

articleSchema.methods.upvoteComment = function (commentId, voterId) {
  const comment = this.comments.id(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  if (comment.upvotedBy.includes(voterId)) {
    comment.upvotes -= 1;
    comment.upvotedBy = comment.upvotedBy.filter((id) => id !== voterId);
  } else {
    if (comment.downvotedBy.includes(voterId)) {
      comment.downvotes -= 1;
      comment.downvotedBy = comment.downvotedBy.filter((id) => id !== voterId);
    }
    comment.upvotes += 1;
    comment.upvotedBy.push(voterId);
  }

  return comment;
};

articleSchema.methods.downvoteComment = function (commentId, voterId) {
  const comment = this.comments.id(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  if (comment.downvotedBy.includes(voterId)) {
    comment.downvotes -= 1;
    comment.downvotedBy = comment.downvotedBy.filter((id) => id !== voterId);
  } else {
    if (comment.upvotedBy.includes(voterId)) {
      comment.upvotes -= 1;
      comment.upvotedBy = comment.upvotedBy.filter((id) => id !== voterId);
    }
    comment.downvotes += 1;
    comment.downvotedBy.push(voterId);
  }

  return comment;
};

articleSchema.methods.upvoteReply = function (commentId, replyId, voterId) {
  const comment = this.comments.id(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const reply = comment.replies.id(replyId);
  if (!reply) {
    throw new Error('Reply not found');
  }

  if (reply.upvotedBy.includes(voterId)) {
    reply.upvotes -= 1;
    reply.upvotedBy = reply.upvotedBy.filter((id) => id !== voterId);
  } else {
    if (reply.downvotedBy.includes(voterId)) {
      reply.downvotes -= 1;
      reply.downvotedBy = reply.downvotedBy.filter((id) => id !== voterId);
    }
    reply.upvotes += 1;
    reply.upvotedBy.push(voterId);
  }

  return reply;
};

articleSchema.methods.downvoteReply = function (commentId, replyId, voterId) {
  const comment = this.comments.id(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const reply = comment.replies.id(replyId);
  if (!reply) {
    throw new Error('Reply not found');
  }

  if (reply.downvotedBy.includes(voterId)) {
    reply.downvotes -= 1;
    reply.downvotedBy = reply.downvotedBy.filter((id) => id !== voterId);
  } else {
    if (reply.upvotedBy.includes(voterId)) {
      reply.upvotes -= 1;
      reply.upvotedBy = reply.upvotedBy.filter((id) => id !== voterId);
    }
    reply.downvotes += 1;
    reply.downvotedBy.push(voterId);
  }

  return reply;
};

const Article = mongoose.model('GhanapolitanArticle', articleSchema);
const Comment = mongoose.model('Comment', commentSchema);

module.exports = { Article, Comment, liveArticleSchema };
