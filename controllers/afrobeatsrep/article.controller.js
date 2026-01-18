const Article = require('../../models/afrobeatsrep/article.model');
const { uploadToR2, deleteFromR2 } = require('../../utils/r2');
const { getRedisClient } = require('../../lib/redis');

const SITE_PREFIX = 'afrobeatsrep';

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

const invalidateArticleCache = async () => {
  await Promise.all([
    deleteCacheByPattern(`${SITE_PREFIX}:articles:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:article:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:article:id:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:headline:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:category:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:search:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:similar:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:subcategory:*`),
  ]);
};

exports.createArticle = async (req, res) => {
  try {
    const {
      title,
      description,
      content,
      category,
      subcategory,
      tags,
      isHeadline,
      label,
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

    if (isHeadline) {
      await Article.updateMany(
        { isHeadline: true },
        { $set: { isHeadline: false } }
      );
      await deleteCacheByPattern(`${SITE_PREFIX}:headline:*`);
    }

    let imageUrl = null;
    if (req.files?.image?.[0]) {
      imageUrl = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'articles'
      );
    }

    let articleSlug = slug;
    if (!articleSlug) {
      articleSlug = Article.prototype.generateSlug(title);
    }

    const existingSlug = await Article.findOne({ slug: articleSlug });
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

    const article = new Article({
      title,
      description,
      content,
      category,
      subcategory: processedSubcategory,
      tags: processedTags,
      isHeadline: isHeadline || false,
      label: label || '',
      meta_title: meta_title || Article.prototype.generateMetaTitle(title),
      meta_description:
        meta_description ||
        Article.prototype.generateMetaDescription({
          title,
          description,
        }),
      creator: creator || 'Admin',
      slug: articleSlug,
      image_url: imageUrl,
      published_at: published_at ? new Date(published_at) : Date.now(),
    });

    await article.save();
    await invalidateArticleCache();

    if (isHeadline) {
      const responseData = { headline: article, similarArticles: [] };
      await setCache(`${SITE_PREFIX}:headline:current`, responseData, null);
    }

    res.status(201).json({
      status: 'success',
      data: { article },
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

exports.updateArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingArticle = await Article.findById(id);

    if (!existingArticle) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    if (req.files?.image?.[0]) {
      if (existingArticle.image_url) {
        await deleteFromR2(existingArticle.image_url);
      }
      updateData.image_url = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'articles'
      );
    }

    if (updateData.isHeadline && !existingArticle.isHeadline) {
      await Article.updateMany(
        { isHeadline: true },
        { $set: { isHeadline: false } }
      );
      updateData.isHeadline = true;
      await deleteCacheByPattern(`${SITE_PREFIX}:headline:*`);
    } else if (existingArticle.isHeadline && !updateData.isHeadline) {
      updateData.isHeadline = false;
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

    if (updateData.title && updateData.title !== existingArticle.title) {
      updateData.slug = Article.prototype.generateSlug(updateData.title);
    }

    const article = await Article.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    await invalidateArticleCache();

    if (article.isHeadline) {
      const responseData = { headline: article, similarArticles: [] };
      await setCache('headline:current', responseData, null);
    }

    res.status(200).json({
      status: 'success',
      data: { article },
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

exports.deleteArticle = async (req, res) => {
  try {
    const { id } = req.params;

    const article = await Article.findById(id);
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    if (article.image_url) {
      await deleteFromR2(article.image_url);
    }

    await article.deleteOne();
    await invalidateArticleCache();

    res.status(200).json({
      status: 'success',
      message: 'Article deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getArticleById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid article ID format',
      });
    }

    const cacheKey = `${SITE_PREFIX}:article:id:${id}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { article: cachedData },
      });
    }

    const article = await Article.findById(id);

    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const responseData = article.toObject();

    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { article: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getArticleBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `${SITE_PREFIX}:article:${slug}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const responseData = article.toObject();
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

exports.getAllArticles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:all', { page, limit });
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
    if (req.query.label) {
      query.label = req.query.label;
    }
    if (req.query.isHeadline) {
      query.isHeadline = req.query.isHeadline === 'true';
    }

    const [articles, total] = await Promise.all([
      Article.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Article.countDocuments(query),
    ]);

    const responseData = {
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
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

exports.getArticlesByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:category', {
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

    const [articles, total] = await Promise.all([
      Article.find({ category })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({ category }),
    ]);

    const responseData = {
      category,
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
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

exports.getArticlesBySubcategory = async (req, res) => {
  try {
    const { subcategory } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:subcategory', {
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

    const [articles, total] = await Promise.all([
      Article.find({ subcategory: { $in: [subcategory] } })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({ subcategory: { $in: [subcategory] } }),
    ]);

    const responseData = {
      subcategory,
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
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

exports.getSimilarArticles = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:similar', {
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

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const tags = article.tags || [];
    if (tags.length === 0) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: { articles: [] },
      });
    }

    const [similarArticles, total] = await Promise.all([
      Article.find({
        _id: { $ne: article._id },
        tags: { $in: tags },
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({
        _id: { $ne: article._id },
        tags: { $in: tags },
      }),
    ]);

    const responseData = {
      results: similarArticles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles: similarArticles },
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

exports.searchArticles = async (req, res) => {
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

    const cacheKey = generateCacheKey('articles:search', {
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

    const [articles, total] = await Promise.all([
      Article.find({
        $or: [
          { title: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { content: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $regex: searchRegex } },
          { label: { $regex: searchRegex } },
        ],
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({
        $or: [
          { title: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { content: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $regex: searchRegex } },
          { label: { $regex: searchRegex } },
        ],
      }),
    ]);

    const responseData = {
      query: q,
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
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

exports.getHeadline = async (req, res) => {
  try {
    const cacheKey = `${SITE_PREFIX}:headline:current`;
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const headline = await Article.findOne({ isHeadline: true }).sort({
      published_at: -1,
    });

    if (!headline) {
      return res.status(404).json({
        status: 'fail',
        message: 'No headline article found',
      });
    }

    const similarArticles = await Article.find({
      _id: { $ne: headline._id },
      tags: { $in: headline.tags || [] },
      isHeadline: false,
    })
      .sort({ published_at: -1 })
      .limit(3);

    const responseData = {
      headline,
      similarArticles,
    };

    await setCache(cacheKey, responseData, null);

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

exports.getRecentArticles = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${SITE_PREFIX}:articles:recent:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentArticles = await Article.find({
      published_at: { $gte: twentyFourHoursAgo },
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, recentArticles, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: recentArticles,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getArticlesByLabel = async (req, res) => {
  try {
    const { label } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:label', {
      label,
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

    const [articles, total] = await Promise.all([
      Article.find({ label })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({ label }),
    ]);

    const responseData = {
      label,
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
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

exports.getFeaturedContent = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const cacheKey = `${SITE_PREFIX}:articles:featured:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const [headline, recentArticles] = await Promise.all([
      Article.findOne({ isHeadline: true }).sort({ published_at: -1 }),
      Article.find({ isHeadline: false })
        .sort({ published_at: -1 })
        .limit(limit - 1),
    ]);

    let allArticles = [];
    if (headline) {
      allArticles.push(headline);
    }
    allArticles = [...allArticles, ...recentArticles].slice(0, limit);

    await setCache(cacheKey, allArticles, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: allArticles,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};
