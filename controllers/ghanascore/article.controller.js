const { Article } = require('../../models/ghanascore/article.model');
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

const invalidateArticleCache = async () => {
  await Promise.all([
    deleteCacheByPattern(`${SITE_PREFIX}:articles:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:article:id:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:headline:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:category:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:article:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:search:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:similar:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:subcategory:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:topstories:*`),
    deleteCacheByPattern(`${SITE_PREFIX}:breaking:*`),
  ]);
};

const updateExpiredTopstories = async () => {
  try {
    const expiredCount = await Article.updateExpiredTopstories();
    if (expiredCount > 0) {
      await deleteCacheByPattern(`${SITE_PREFIX}:topstories:*`);
      await deleteCacheByPattern(`${SITE_PREFIX}:articles:*`);
    }
    return expiredCount;
  } catch (err) {
    console.error('Error updating expired top stories:', err);
    return 0;
  }
};

const updateExpiredBreakingNews = async () => {
  try {
    const expiredCount = await Article.updateExpiredBreakingNews();
    if (expiredCount > 0) {
      await deleteCacheByPattern(`${SITE_PREFIX}:breaking:*`);
      await deleteCacheByPattern(`${SITE_PREFIX}:articles:*`);
    }
    return expiredCount;
  } catch (err) {
    console.error('Error updating expired breaking news:', err);
    return 0;
  }
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
      isLive,
      isBreaking,
      isHeadline,
      isTopstory,
      hasLivescore,
      livescoreTag,
      breakingExpiresAt,
      topstoryExpiresAt,
      source_name,
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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

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

    let articleContent;
    if (isLive) {
      if (typeof content === 'string') {
        articleContent = [
          {
            content_title: title,
            content_description: description,
            content_detail: content,
            content_image_url: imageUrl,
            content_published_at: new Date(published_at || Date.now()),
            isKey: false,
          },
        ];
      } else if (Array.isArray(content)) {
        articleContent = content;
      } else {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid content format for live article',
        });
      }
    } else {
      articleContent = content;
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

    let calculatedTopstoryExpiresAt = topstoryExpiresAt;
    if (isTopstory && !topstoryExpiresAt) {
      calculatedTopstoryExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    }

    const article = new Article({
      title,
      description,
      content: articleContent,
      category,
      subcategory: processedSubcategory,
      tags: processedTags,
      isLive: isLive || false,
      wasLive: false,
      isBreaking: isBreaking || false,
      isTopstory: isTopstory || false,
      hasLivescore: hasLivescore || false,
      livescoreTag: hasLivescore ? livescoreTag : undefined,
      breakingExpiresAt: isBreaking ? breakingExpiresAt : undefined,
      topstoryExpiresAt: isTopstory ? calculatedTopstoryExpiresAt : undefined,
      isHeadline: isHeadline || false,
      source_name: source_name || 'Ghana score',
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
      return res
        .status(404)
        .json({ status: 'fail', message: 'Article not found' });
    }

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const parseBoolean = (value) => {
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0' || value === '') return false;
      return Boolean(value);
    };

    const parseJSON = (value, fallback = undefined) => {
      if (value === undefined || value === null) return fallback;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      }
      return value;
    };

    [
      'isBreaking',
      'isHeadline',
      'isTopstory',
      'isLive',
      'hasLivescore',
    ].forEach((field) => {
      if (updateData[field] !== undefined) {
        updateData[field] = parseBoolean(updateData[field]);
      }
    });

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
      await deleteCacheByPattern(`${SITE_PREFIX}:headline:*`);
    } else if (existingArticle.isHeadline && updateData.isHeadline === false) {
      updateData.isHeadline = false;
    }

    if (updateData.isBreaking && !existingArticle.isBreaking) {
      updateData.breakingExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    } else if (!updateData.isBreaking && existingArticle.isBreaking) {
      updateData.breakingExpiresAt = null;
    }

    if (updateData.isTopstory && !existingArticle.isTopstory) {
      updateData.topstoryExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    } else if (!updateData.isTopstory && existingArticle.isTopstory) {
      updateData.topstoryExpiresAt = null;
    }

    if (updateData.hasLivescore && !updateData.livescoreTag) {
      return res.status(400).json({
        status: 'fail',
        message: 'livescoreTag is required when hasLivescore is true',
      });
    }
    if (!updateData.hasLivescore && updateData.livescoreTag) {
      updateData.livescoreTag = undefined;
    }

    if (typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    if (typeof updateData.subcategory === 'string') {
      updateData.subcategory = updateData.subcategory
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const parsedContent = parseJSON(updateData.content, updateData.content);

    if (updateData.isLive) {
      if (!Array.isArray(parsedContent)) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid content format for live article (expected array)',
        });
      }
      updateData.content = parsedContent;
    } else {
      updateData.content = parsedContent ?? updateData.content;
    }

    if (updateData.title && updateData.title !== existingArticle.title) {
      updateData.slug = Article.prototype.generateSlug(updateData.title);
    }

    const article = await Article.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    await invalidateArticleCache();

    return res.status(200).json({
      status: 'success',
      data: { article },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(400)
        .json({ status: 'fail', message: 'Slug must be unique' });
    }
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        status: 'fail',
        message: 'Validation failed',
        errors,
      });
    }
    return res.status(500).json({ status: 'error', message: err.message });
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

    if (article.isLive && Array.isArray(article.content)) {
      for (const contentBlock of article.content) {
        if (contentBlock.content_image_url) {
          await deleteFromR2(contentBlock.content_image_url);
        }
      }
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

    await updateExpiredBreakingNews();

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    if (article.isTopstory && article.isTopstoryExpired()) {
      article.isTopstory = false;
      article.topstoryExpiresAt = null;
      await article.save();
      await deleteCacheByPattern(`${SITE_PREFIX}:topstories:*`);
    }

    const responseData = article.toObject();

    if (article.isLive) {
      responseData.keyEvents = article.content.filter((item) => item.isKey);
    }

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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const query = {};

    if (req.query.isBreaking) {
      query.isBreaking = req.query.isBreaking === 'true';
    }
    if (req.query.isLive) {
      query.isLive = req.query.isLive === 'true';
    }
    if (req.query.isTopstory) {
      query.isTopstory = req.query.isTopstory === 'true';
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

exports.getTopStoriesByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${SITE_PREFIX}:topstories:category:${category}:${limit}`;

    await updateExpiredTopstories();

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const topStories = await Article.find({
      isTopstory: true,
      category: category,
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, topStories, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: topStories,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getRecentTopStories = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${SITE_PREFIX}:topstories:recent:${limit}`;

    await updateExpiredTopstories();

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const topStories = await Article.find({
      isTopstory: true,
      published_at: { $gte: twentyFourHoursAgo },
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, topStories, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: topStories,
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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const searchRegex = new RegExp(q, 'i');

    const [articles, total] = await Promise.all([
      Article.find({
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
      Article.countDocuments({
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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

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

exports.getTopStories = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${SITE_PREFIX}:topstories:${limit}`;

    await updateExpiredTopstories();

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const topStories = await Article.find({
      isTopstory: true,
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, topStories, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: topStories,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getBreakingNews = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const cacheKey = `${SITE_PREFIX}:breaking:${limit}`;

    await updateExpiredBreakingNews();

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: cachedData,
      });
    }

    const breakingNews = await Article.find({
      isBreaking: true,
    })
      .sort({ published_at: -1 })
      .limit(limit);

    await setCache(cacheKey, breakingNews, 60);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: breakingNews,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getLiveArticles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:live', { page, limit });
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const [articles, total] = await Promise.all([
      Article.find({ isLive: true })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({ isLive: true }),
    ]);

    const responseData = {
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
    };

    await setCache(cacheKey, responseData, 60);

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

exports.getArticlesByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const validStatuses = ['live', 'breaking', 'topstory', 'topstories', 'headline'];
    const normalizedStatus = status.toLowerCase();

    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid status. Valid statuses are: ${validStatuses.join(', ')}`,
      });
    }

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const cacheKey = generateCacheKey('articles:status', {
      status: normalizedStatus,
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

    let query = {};
    
    switch (normalizedStatus) {
      case 'live':
        query.isLive = true;
        break;
      case 'breaking':
        query.isBreaking = true;
        break;
      case 'topstory':
      case 'topstories':
        query.isTopstory = true;
        break;
      case 'headline':
        query.isHeadline = true;
        break;
    }

    const [articles, total] = await Promise.all([
      Article.find(query)
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments(query),
    ]);

    const responseData = {
      status: normalizedStatus,
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
    };

    const cacheExpiration = normalizedStatus === 'breaking' || normalizedStatus === 'live' ? 60 : 300;
    await setCache(cacheKey, responseData, cacheExpiration);

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

exports.getArticlesByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const validStatuses = ['breaking', 'live', 'topstory', 'headline'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message:
          'Invalid status. Valid statuses: breaking, live, topstory, headline',
      });
    }

    const statusMap = {
      breaking: 'isBreaking',
      live: 'isLive',
      topstory: 'isTopstory',
      headline: 'isHeadline',
    };

    const statusField = statusMap[status];

    const cacheKey = generateCacheKey('articles:status', {
      status,
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

    if (status === 'breaking') {
      await updateExpiredBreakingNews();
    } else if (status === 'topstory') {
      await updateExpiredTopstories();
    }

    const query = { [statusField]: true };

    if (req.query.category) {
      query.category = req.query.category;
    }

    if (req.query.subcategory) {
      query.subcategory = { $in: [req.query.subcategory] };
    }

    if (req.query.hasLivescore !== undefined) {
      query.hasLivescore = req.query.hasLivescore === 'true';
    }

    if (req.query.livescoreTag) {
      query.livescoreTag = req.query.livescoreTag;
    }

    const [articles, total] = await Promise.all([
      Article.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Article.countDocuments(query),
    ]);

    const responseData = {
      statusType: status,
      results: articles.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { articles },
    };

    let cacheExpiration = 300;

    if (status === 'breaking') {
      cacheExpiration = 60;
    } else if (status === 'live') {
      cacheExpiration = 60;
    }

    await setCache(cacheKey, responseData, cacheExpiration);

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
