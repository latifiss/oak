const Graphic = require('../../models/ghanapolitan/graphic.model');
const { uploadToR2, deleteFromR2 } = require('../../utils/r2');
const { getRedisClient } = require('../../lib/redis');

const SITE_PREFIX = 'ghanapolitan';

const generateCacheKey = (prefix, params) => {
  return `${SITE_PREFIX}:graphics:${prefix}:${Object.values(params).join(':')}`;
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

const invalidateGraphicCache = async () => {
  await Promise.all([
    deleteCacheByPattern(`${SITE_PREFIX}:graphics:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:graphic:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:graphic:id:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:graphic:category:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:graphic:search:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:graphic:similar:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:graphic:subcategory:*`),
  ]);
};

exports.createGraphic = async (req, res) => {
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
        'graphics'
      );
    }

    let graphicSlug = slug;
    if (!graphicSlug) {
      graphicSlug = Graphic.prototype.generateSlug(title);
    }

    const existingSlug = await Graphic.findOne({ slug: graphicSlug });
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

    const graphic = new Graphic({
      title,
      description,
      content,
      category,
      subcategory: processedSubcategory,
      tags: processedTags,
      meta_title: meta_title || Graphic.prototype.generateMetaTitle(title),
      meta_description:
        meta_description ||
        Graphic.prototype.generateMetaDescription({
          title,
          description,
        }),
      creator: creator || 'Admin',
      slug: graphicSlug,
      image_url: imageUrl,
      published_at: published_at ? new Date(published_at) : Date.now(),
    });

    await graphic.save();
    await invalidateGraphicCache();

    res.status(201).json({
      status: 'success',
      data: { graphic },
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

exports.updateGraphic = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingGraphic = await Graphic.findById(id);

    if (!existingGraphic) {
      return res.status(404).json({
        status: 'fail',
        message: 'Graphic not found',
      });
    }

    if (req.files?.image?.[0]) {
      if (existingGraphic.image_url) {
        await deleteFromR2(existingGraphic.image_url);
      }
      updateData.image_url = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'graphics'
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

    if (updateData.title && updateData.title !== existingGraphic.title) {
      updateData.slug = Graphic.prototype.generateSlug(updateData.title);
    }

    const graphic = await Graphic.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    await invalidateGraphicCache();

    res.status(200).json({
      status: 'success',
      data: { graphic },
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

exports.deleteGraphic = async (req, res) => {
  try {
    const { id } = req.params;

    const graphic = await Graphic.findById(id);
    if (!graphic) {
      return res.status(404).json({
        status: 'fail',
        message: 'Graphic not found',
      });
    }

    if (graphic.image_url) {
      await deleteFromR2(graphic.image_url);
    }

    await graphic.deleteOne();
    await invalidateGraphicCache();

    res.status(200).json({
      status: 'success',
      message: 'Graphic deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getGraphicById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid graphic ID format',
      });
    }

    const cacheKey = `${SITE_PREFIX}:graphic:id:${id}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { graphic: cachedData },
      });
    }

    const graphic = await Graphic.findById(id);

    if (!graphic) {
      return res.status(404).json({
        status: 'fail',
        message: 'Graphic not found',
      });
    }

    const responseData = graphic.toObject();

    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { graphic: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getGraphicBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `${SITE_PREFIX}:graphic:${slug}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const graphic = await Graphic.findOne({ slug });
    if (!graphic) {
      return res.status(404).json({
        status: 'fail',
        message: 'Graphic not found',
      });
    }

    const responseData = graphic.toObject();
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

exports.getAllGraphics = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('all', { page, limit });
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

    const [graphics, total] = await Promise.all([
      Graphic.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Graphic.countDocuments(query),
    ]);

    const responseData = {
      results: graphics.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { graphics },
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

exports.getGraphicsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('category', {
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

    const [graphics, total] = await Promise.all([
      Graphic.find({ category })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Graphic.countDocuments({ category }),
    ]);

    const responseData = {
      category,
      results: graphics.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { graphics },
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

exports.getGraphicsBySubcategory = async (req, res) => {
  try {
    const { subcategory } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('subcategory', {
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

    const [graphics, total] = await Promise.all([
      Graphic.find({ subcategory: { $in: [subcategory] } })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Graphic.countDocuments({ subcategory: { $in: [subcategory] } }),
    ]);

    const responseData = {
      subcategory,
      results: graphics.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { graphics },
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

exports.getSimilarGraphics = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('similar', {
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

    const graphic = await Graphic.findOne({ slug });
    if (!graphic) {
      return res.status(404).json({
        status: 'fail',
        message: 'Graphic not found',
      });
    }

    const tags = graphic.tags || [];
    if (tags.length === 0) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: { graphics: [] },
      });
    }

    const [similarGraphics, total] = await Promise.all([
      Graphic.find({
        _id: { $ne: graphic._id },
        tags: { $in: tags },
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Graphic.countDocuments({
        _id: { $ne: graphic._id },
        tags: { $in: tags },
      }),
    ]);

    const responseData = {
      results: similarGraphics.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { graphics: similarGraphics },
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

exports.searchGraphics = async (req, res) => {
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

    const cacheKey = generateCacheKey('search', {
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

    const [graphics, total] = await Promise.all([
      Graphic.find({
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
      Graphic.countDocuments({
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
      results: graphics.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { graphics },
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

exports.getRecentGraphics = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${SITE_PREFIX}:graphics:recent:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentGraphics = await Graphic.find({
      published_at: { $gte: twentyFourHoursAgo },
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, recentGraphics, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: recentGraphics,
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
    const cacheKey = `${SITE_PREFIX}:graphics:featured:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const [recentGraphics, popularGraphics] = await Promise.all([
      Graphic.find({})
        .sort({ published_at: -1 })
        .limit(Math.floor(limit / 2)),
      Graphic.aggregate([
        { $sample: { size: Math.floor(limit / 2) } },
        { $sort: { published_at: -1 } },
      ]),
    ]);

    const allGraphics = [...recentGraphics, ...popularGraphics];
    const uniqueGraphics = allGraphics.filter(
      (graphic, index, self) =>
        index ===
        self.findIndex((g) => g._id.toString() === graphic._id.toString())
    );

    await setCache(cacheKey, uniqueGraphics.slice(0, limit), 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: uniqueGraphics.slice(0, limit),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};
