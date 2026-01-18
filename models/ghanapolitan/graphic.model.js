const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const graphicSchema = new Schema(
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

graphicSchema.pre('save', async function () {
  if (this.isModified('title')) {
    this.slug = this.generateSlug(this.title);
  }
});

graphicSchema.methods.generateMetaTitle = function (title) {
  if (!title) return '';
  const cleanedTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '');
  if (cleanedTitle.length <= 60) return cleanedTitle;
  return cleanedTitle.substring(0, 57).trim() + '...';
};

graphicSchema.methods.generateMetaDescription = function (data) {
  if (data.description) {
    return data.description.substring(0, 155).trim();
  }
  return `${data.title || 'Graphic'}. ${
    data.description || 'Read our detailed graphic.'
  }`.substring(0, 155);
};

graphicSchema.methods.generateSlug = function (title) {
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

const Graphic = mongoose.model('GhanapolitanGraphics', graphicSchema);

module.exports = Graphic;
