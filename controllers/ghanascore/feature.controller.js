const Feature = require('../../models/ghanascore/feature.model');
const { uploadToR2, deleteFromR2 } = require('../../utils/r2');
const { getRedisClient } = require('../../lib/redis');

const SITE_PREFIX = 'ghanascore';

const generateCacheKey = (prefix, params) => {
  return `${SITE_PREFIX}:${prefix}:${Object.values(params).join(':')}`;
};

const setCache = async (key, data, expiration = 3600) => {
  try {
    const client = await getRedisClient();
    if (expiration === null) {
      await client.set(key, JSON.stringify(data));
    } else {
      await client.setEx(key, expiration, JSON.stringify(data));
    }
  } catch (err) {
    console.error('Redis set error:', err);
  }
};

const getCache = async (key) => {
  try {
    const client = await getRedisClient();
    const cachedData = await client.get(key);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (err) {
    console.error('Redis get error:', err);
    return null;
  }
};

const deleteCacheByPattern = async (pattern) => {
  try {
    const client = await getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
    }
  } catch (err) {
    console.error('Redis delete error:', err);
  }
};

const invalidateFeatureCache = async () => {
  await Promise.all([
    deleteCacheByPattern(`${SITE_PREFIX}:features:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:feature:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:feature:id:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:category:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:search:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:similar:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:subcategory:*`),
  ]);
};

exports.createFeature = async (req, res) => {
  try {
    const {
      title,
      description,
      content,
      category,
      subcategory,
      tags,
      meta_title,
      meta_description,
      creator,
      slug,
      published_at,
    } = req.body;

    if (!title || !description || !content || !category) {
      return res.status(400).json({
        status: 'fail',
        message: 'Title, description, content, and category are required',
      });
    }

    let imageUrl = null;
    if (req.files?.image?.[0]) {
      imageUrl = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'features'
      );
    }

    let featureSlug = slug;
    if (!featureSlug) {
      featureSlug = Feature.prototype.generateSlug(title);
    }

    const existingSlug = await Feature.findOne({ slug: featureSlug });
    if (existingSlug) {
      return res.status(400).json({
        status: 'fail',
        message: 'Slug already exists',
      });
    }

    let processedTags = [];
    if (tags) {
      if (typeof tags === 'string') {
        processedTags = tags.split(',').map((tag) => tag.trim());
      } else if (Array.isArray(tags)) {
        processedTags = tags;
      }
    }

    let processedSubcategory = [];
    if (subcategory) {
      if (typeof subcategory === 'string') {
        processedSubcategory = subcategory.split(',').map((sub) => sub.trim());
      } else if (Array.isArray(subcategory)) {
        processedSubcategory = subcategory;
      }
    }

    const feature = new Feature({
      title,
      description,
      content,
      category,
      subcategory: processedSubcategory,
      tags: processedTags,
      meta_title: meta_title || Feature.prototype.generateMetaTitle(title),
      meta_description:
        meta_description ||
        Feature.prototype.generateMetaDescription({
          title,
          description,
        }),
      creator: creator || 'Admin',
      slug: featureSlug,
      image_url: imageUrl,
      published_at: published_at ? new Date(published_at) : Date.now(),
    });

    await feature.save();
    await invalidateFeatureCache();

    res.status(201).json({
      status: 'success',
      data: { feature },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        status: 'fail',
        message: 'Slug must be unique',
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.updateFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingFeature = await Feature.findById(id);

    if (!existingFeature) {
      return res.status(404).json({
        status: 'fail',
        message: 'Feature not found',
      });
    }

    if (req.files?.image?.[0]) {
      if (existingFeature.image_url) {
        await deleteFromR2(existingFeature.image_url);
      }
      updateData.image_url = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'features'
      );
    }

    if (updateData.tags) {
      if (typeof updateData.tags === 'string') {
        updateData.tags = updateData.tags.split(',').map((tag) => tag.trim());
      }
    }

    if (updateData.subcategory) {
      if (typeof updateData.subcategory === 'string') {
        updateData.subcategory = updateData.subcategory
          .split(',')
          .map((sub) => sub.trim());
      }
    }

    if (updateData.title && updateData.title !== existingFeature.title) {
      updateData.slug = Feature.prototype.generateSlug(updateData.title);
    }

    const feature = await Feature.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    await invalidateFeatureCache();

    res.status(200).json({
      status: 'success',
      data: { feature },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        status: 'fail',
        message: 'Slug must be unique',
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.deleteFeature = async (req, res) => {
  try {
    const { id } = req.params;

    const feature = await Feature.findById(id);
    if (!feature) {
      return res.status(404).json({
        status: 'fail',
        message: 'Feature not found',
      });
    }

    if (feature.image_url) {
      await deleteFromR2(feature.image_url);
    }

    await feature.deleteOne();
    await invalidateFeatureCache();

    res.status(200).json({
      status: 'success',
      message: 'Feature deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getFeatureById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid feature ID format',
      });
    }

    const cacheKey = `${SITE_PREFIX}:feature:id:${id}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { feature: cachedData },
      });
    }

    const feature = await Feature.findById(id);

    if (!feature) {
      return res.status(404).json({
        status: 'fail',
        message: 'Feature not found',
      });
    }

    const responseData = feature.toObject();

    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { feature: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getFeatureBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `${SITE_PREFIX}:feature:${slug}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const feature = await Feature.findOne({ slug });
    if (!feature) {
      return res.status(404).json({
        status: 'fail',
        message: 'Feature not found',
      });
    }

    const responseData = feature.toObject();
    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: responseData,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getAllFeatures = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('features:all', { page, limit });
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const query = {};

    if (req.query.category) {
      query.category = req.query.category;
    }

    const [features, total] = await Promise.all([
      Feature.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Feature.countDocuments(query),
    ]);

    const responseData = {
      results: features.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { features },
    };

    await setCache(cacheKey, responseData, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      ...responseData,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getFeaturesByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('features:category', {
      category,
      page,
      limit,
    });
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const [features, total] = await Promise.all([
      Feature.find({ category })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Feature.countDocuments({ category }),
    ]);

    const responseData = {
      category,
      results: features.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { features },
    };

    await setCache(cacheKey, responseData, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      ...responseData,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getFeaturesBySubcategory = async (req, res) => {
  try {
    const { subcategory } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('features:subcategory', {
      subcategory,
      page,
      limit,
    });
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const [features, total] = await Promise.all([
      Feature.find({ subcategory: { $in: [subcategory] } })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Feature.countDocuments({ subcategory: { $in: [subcategory] } }),
    ]);

    const responseData = {
      subcategory,
      results: features.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { features },
    };

    await setCache(cacheKey, responseData, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      ...responseData,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getSimilarFeatures = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('features:similar', {
      slug,
      page,
      limit,
    });
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const feature = await Feature.findOne({ slug });
    if (!feature) {
      return res.status(404).json({
        status: 'fail',
        message: 'Feature not found',
      });
    }

    const tags = feature.tags || [];
    if (tags.length === 0) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: { features: [] },
      });
    }

    const [similarFeatures, total] = await Promise.all([
      Feature.find({
        _id: { $ne: feature._id },
        tags: { $in: tags },
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Feature.countDocuments({
        _id: { $ne: feature._id },
        tags: { $in: tags },
      }),
    ]);

    const responseData = {
      results: similarFeatures.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { features: similarFeatures },
    };

    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      ...responseData,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.searchFeatures = async (req, res) => {
  try {
    const { q } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (!q || q.trim() === '') {
      return res.status(400).json({
        status: 'fail',
        message: 'Search query is required',
      });
    }

    const cacheKey = generateCacheKey('features:search', {
      q,
      page,
      limit,
    });
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const searchRegex = new RegExp(q, 'i');

    const [features, total] = await Promise.all([
      Feature.find({
        $or: [
          { title: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { content: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $regex: searchRegex } },
        ],
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Feature.countDocuments({
        $or: [
          { title: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { content: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $regex: searchRegex } },
        ],
      }),
    ]);

    const responseData = {
      query: q,
      results: features.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { features },
    };

    await setCache(cacheKey, responseData, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      ...responseData,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getRecentFeatures = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${SITE_PREFIX}:features:recent:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentFeatures = await Feature.find({
      published_at: { $gte: twentyFourHoursAgo },
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, recentFeatures, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: recentFeatures,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getFeaturedContent = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const cacheKey = `${SITE_PREFIX}:features:featured:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const [recentFeatures, popularFeatures] = await Promise.all([
      Feature.find({})
        .sort({ published_at: -1 })
        .limit(Math.floor(limit / 2)),
      Feature.aggregate([
        { $sample: { size: Math.floor(limit / 2) } },
        { $sort: { published_at: -1 } },
      ]),
    ]);

    const allFeatures = [...recentFeatures, ...popularFeatures];
    const uniqueFeatures = allFeatures.filter(
      (feature, index, self) =>
        index ===
        self.findIndex((f) => f._id.toString() === feature._id.toString())
    );

    await setCache(cacheKey, uniqueFeatures.slice(0, limit), 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: uniqueFeatures.slice(0, limit),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};
