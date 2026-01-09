const Opinion = require('../../models/ghanapolitan/opinion.model');
const { uploadToR2, deleteFromR2 } = require('../../utils/r2');
const { getRedisClient } = require('../../lib/redis');

const generateCacheKey = (prefix, params) => {
  return `${prefix}:${Object.values(params).join(':')}`;
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

const invalidateOpinionCache = async () => {
  await Promise.all([
    deleteCacheByPattern('opinions:*'),
    deleteCacheByPattern('opinion:*'),
    deleteCacheByPattern('opinion:id:*'),
    deleteCacheByPattern('category:*'),
    deleteCacheByPattern('search:*'),
    deleteCacheByPattern('similar:*'),
  ]);
};

exports.createOpinion = async (req, res) => {
  try {
    const {
      title,
      description,
      content,
      category,
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
        'opinions'
      );
    }

    let opinionSlug = slug;
    if (!opinionSlug) {
      opinionSlug = Opinion.prototype.generateSlug(title);
    }

    const existingSlug = await Opinion.findOne({ slug: opinionSlug });
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

    const opinion = new Opinion({
      title,
      description,
      content,
      category,
      tags: processedTags,
      meta_title: meta_title || Opinion.prototype.generateMetaTitle(title),
      meta_description:
        meta_description ||
        Opinion.prototype.generateMetaDescription({
          title,
          description,
        }),
      creator: creator || 'Admin',
      slug: opinionSlug,
      image_url: imageUrl,
      published_at: published_at ? new Date(published_at) : Date.now(),
    });

    await opinion.save();
    await invalidateOpinionCache();

    res.status(201).json({
      status: 'success',
      data: { opinion },
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

exports.updateOpinion = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingOpinion = await Opinion.findById(id);

    if (!existingOpinion) {
      return res.status(404).json({
        status: 'fail',
        message: 'Opinion not found',
      });
    }

    if (req.files?.image?.[0]) {
      if (existingOpinion.image_url) {
        await deleteFromR2(existingOpinion.image_url);
      }
      updateData.image_url = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'opinions'
      );
    }

    if (updateData.tags) {
      if (typeof updateData.tags === 'string') {
        updateData.tags = updateData.tags.split(',').map((tag) => tag.trim());
      }
    }

    if (updateData.title && updateData.title !== existingOpinion.title) {
      updateData.slug = Opinion.prototype.generateSlug(updateData.title);
    }

    const opinion = await Opinion.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    await invalidateOpinionCache();

    res.status(200).json({
      status: 'success',
      data: { opinion },
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

exports.deleteOpinion = async (req, res) => {
  try {
    const { id } = req.params;

    const opinion = await Opinion.findById(id);
    if (!opinion) {
      return res.status(404).json({
        status: 'fail',
        message: 'Opinion not found',
      });
    }

    if (opinion.image_url) {
      await deleteFromR2(opinion.image_url);
    }

    await opinion.deleteOne();
    await invalidateOpinionCache();

    res.status(200).json({
      status: 'success',
      message: 'Opinion deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getOpinionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid opinion ID format',
      });
    }

    const cacheKey = `opinion:id:${id}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { opinion: cachedData },
      });
    }

    const opinion = await Opinion.findById(id);

    if (!opinion) {
      return res.status(404).json({
        status: 'fail',
        message: 'Opinion not found',
      });
    }

    const responseData = opinion.toObject();

    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { opinion: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getOpinionBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `opinion:${slug}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const opinion = await Opinion.findOne({ slug });
    if (!opinion) {
      return res.status(404).json({
        status: 'fail',
        message: 'Opinion not found',
      });
    }

    const responseData = opinion.toObject();
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

exports.getAllOpinions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('opinions:all', { page, limit });
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

    const [opinions, total] = await Promise.all([
      Opinion.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Opinion.countDocuments(query),
    ]);

    const responseData = {
      results: opinions.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { opinions },
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

exports.getOpinionsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('opinions:category', {
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

    const [opinions, total] = await Promise.all([
      Opinion.find({ category })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Opinion.countDocuments({ category }),
    ]);

    const responseData = {
      category,
      results: opinions.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { opinions },
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

exports.getSimilarOpinions = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('opinions:similar', {
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

    const opinion = await Opinion.findOne({ slug });
    if (!opinion) {
      return res.status(404).json({
        status: 'fail',
        message: 'Opinion not found',
      });
    }

    const tags = opinion.tags || [];
    if (tags.length === 0) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: { opinions: [] },
      });
    }

    const [similarOpinions, total] = await Promise.all([
      Opinion.find({
        _id: { $ne: opinion._id },
        tags: { $in: tags },
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Opinion.countDocuments({
        _id: { $ne: opinion._id },
        tags: { $in: tags },
      }),
    ]);

    const responseData = {
      results: similarOpinions.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { opinions: similarOpinions },
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

exports.searchOpinions = async (req, res) => {
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

    const cacheKey = generateCacheKey('opinions:search', {
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

    const [opinions, total] = await Promise.all([
      Opinion.find({
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
      Opinion.countDocuments({
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
      results: opinions.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { opinions },
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

exports.getRecentOpinions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `opinions:recent:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentOpinions = await Opinion.find({
      published_at: { $gte: twentyFourHoursAgo },
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, recentOpinions, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: recentOpinions,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getFeaturedOpinions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const cacheKey = `opinions:featured:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const [recentOpinions, popularOpinions] = await Promise.all([
      Opinion.find({})
        .sort({ published_at: -1 })
        .limit(Math.floor(limit / 2)),
      Opinion.aggregate([
        { $sample: { size: Math.floor(limit / 2) } },
        { $sort: { published_at: -1 } },
      ]),
    ]);

    const allOpinions = [...recentOpinions, ...popularOpinions];
    const uniqueOpinions = allOpinions.filter(
      (opinion, index, self) =>
        index ===
        self.findIndex((o) => o._id.toString() === opinion._id.toString())
    );

    await setCache(cacheKey, uniqueOpinions.slice(0, limit), 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: uniqueOpinions.slice(0, limit),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};
