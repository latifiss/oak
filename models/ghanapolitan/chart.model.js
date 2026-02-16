const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CHART_TYPES = {
  BAR: 'bar',
  STACKED_BAR: 'stacked_bar',
  LINE: 'line',
  AREA: 'area',
  SCATTER: 'scatter',
  PIE: 'pie',
  DONUT: 'donut',
  HEATMAP: 'heatmap',
  HISTOGRAM: 'histogram',
  BUBBLE: 'bubble',
  RADAR: 'radar',
  TREEMAP: 'treemap',
  SANKEY: 'sankey',
};

const DATA_TYPES = {
  NUMERIC: 'numeric',
  CATEGORICAL: 'categorical',
  TEMPORAL: 'temporal',
  GEOGRAPHICAL: 'geographical',
};

const chartSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    chart_type: {
      type: String,
      required: true,
      enum: Object.values(CHART_TYPES),
      default: CHART_TYPES.BAR,
    },

    chart_config: {
      type: Schema.Types.Mixed,
      default: {},
    },

    data_schema: {
      columns: [
        {
          name: {
            type: String,
            required: true,
          },
          data_type: {
            type: String,
            enum: Object.values(DATA_TYPES),
            default: DATA_TYPES.NUMERIC,
          },
          description: String,
          format: String,
          is_index: {
            type: Boolean,
            default: false,
          },
          is_dimension: {
            type: Boolean,
            default: false,
          },
          is_measure: {
            type: Boolean,
            default: false,
          },
        },
      ],
      metadata: {
        source: String,
        source_url: String,
        last_updated: Date,
        collection_date: Date,
        geographic_scope: String,
        time_period: String,
        methodology: String,
        notes: String,
      },
    },

    chart_data: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator: function (data) {
          return Array.isArray(data) && data.length > 0;
        },
        message: 'Chart data must be a non-empty array',
      },
    },

    display_config: {
      colors: [String],
      animation: {
        enabled: { type: Boolean, default: true },
        duration: { type: Number, default: 1000 },
      },
      tooltip: {
        enabled: { type: Boolean, default: true },
        format: String,
      },
      legend: {
        enabled: { type: Boolean, default: true },
        position: {
          type: String,
          enum: ['top', 'right', 'bottom', 'left'],
          default: 'right',
        },
      },
      axis: {
        x: {
          title: String,
          gridLines: { type: Boolean, default: true },
          ticks: Schema.Types.Mixed,
        },
        y: {
          title: String,
          gridLines: { type: Boolean, default: true },
          ticks: Schema.Types.Mixed,
        },
      },
      responsive: { type: Boolean, default: true },
      maintainAspectRatio: { type: Boolean, default: true },
    },

    content: {
      type: Schema.Types.Mixed,
      default: {},
    },

    category: {
      type: String,
      required: true,
      trim: true,
    },

    subcategories: [
      {
        type: String,
        trim: true,
      },
    ],

    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    meta_title: {
      type: String,
      maxlength: 60,
    },

    meta_description: {
      type: String,
      maxlength: 160,
    },

    creator: {
      name: {
        type: String,
        default: 'Admin',
      },
      email: String,
      avatar: String,
    },

    featured_image: {
      url: String,
      alt: String,
      caption: String,
    },

    embed_code: String,
    embed_enabled: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },

    published_at: {
      type: Date,
      default: null,
    },

    version: {
      type: Number,
      default: 1,
    },

    views: {
      type: Number,
      default: 0,
    },

    related_charts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Chart',
      },
    ],

    source_files: [
      {
        filename: String,
        url: String,
        format: String,
        size: Number,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

chartSchema.index({ slug: 1 });
chartSchema.index({ category: 1, status: 1 });
chartSchema.index({ tags: 1 });
chartSchema.index({ published_at: -1 });
chartSchema.index({ views: -1 });
chartSchema.index({ title: 'text', description: 'text' });

chartSchema.pre('save', async function () {
  if (!this.slug && this.title) {
    this.slug = this.generateSlug(this.title);
  }

  if (!this.meta_title && this.title) {
    this.meta_title = this.generateMetaTitle(this.title);
  }

  if (!this.meta_description && this.description) {
    this.meta_description = this.generateMetaDescription(this.description);
  }

  if (
    this.isModified('status') &&
    this.status === 'published' &&
    !this.published_at
  ) {
    this.published_at = new Date();
  }

  if (this.isModified() && !this.isNew) {
    this.version += 1;
  }
});

chartSchema.methods.generateSlug = function (title) {
  return title
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .substring(0, 100);
};

chartSchema.methods.generateMetaTitle = function (title) {
  const cleaned = title.replace(/[^a-zA-Z0-9\s-]/g, '');
  return cleaned.length <= 60
    ? cleaned
    : cleaned.substring(0, 57).trim() + '...';
};

chartSchema.methods.generateMetaDescription = function (description) {
  const cleaned = description.replace(/[^a-zA-Z0-9\s-.,]/g, '');
  return cleaned.length <= 160
    ? cleaned
    : cleaned.substring(0, 157).trim() + '...';
};

chartSchema.methods.getChartConfig = function () {
  const baseConfig = {
    type: this.chart_type,
    data: {
      datasets: this.chart_data,
      labels:
        this.data_schema?.columns
          ?.filter((col) => col.is_index)
          .map((col) => col.name) || [],
    },
    options: {
      responsive: this.display_config.responsive,
      maintainAspectRatio: this.display_config.maintainAspectRatio,
      animation: this.display_config.animation,
      plugins: {
        legend: this.display_config.legend,
        tooltip: this.display_config.tooltip,
      },
      scales: this.display_config.axis,
    },
  };

  switch (this.chart_type) {
    case CHART_TYPES.STACKED_BAR:
      baseConfig.options.scales = {
        x: { stacked: true, ...this.display_config.axis.x },
        y: { stacked: true, ...this.display_config.axis.y },
      };
      break;
    case CHART_TYPES.PIE:
    case CHART_TYPES.DONUT:
      delete baseConfig.options.scales;
      break;
  }

  return baseConfig;
};

chartSchema.statics.findByType = function (type) {
  return this.find({ chart_type: type, status: 'published' });
};

chartSchema.statics.findPopular = function (limit = 10) {
  return this.find({ status: 'published' }).sort({ views: -1 }).limit(limit);
};

chartSchema.statics.findRecent = function (limit = 10) {
  return this.find({ status: 'published' })
    .sort({ published_at: -1 })
    .limit(limit);
};

chartSchema.virtual('preview_url').get(function () {
  return `/charts/${this.slug}/preview`;
});

chartSchema.virtual('embed_url').get(function () {
  return `/embed/chart/${this._id}`;
});

const Chart = mongoose.model('Chart', chartSchema);

module.exports = {
  Chart,
  CHART_TYPES,
  DATA_TYPES,
};
