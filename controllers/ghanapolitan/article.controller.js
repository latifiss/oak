const { Article, Comment } = require('../../models/ghanapolitan/article.model');
const Section = require('../../models/ghanapolitan/section.model');
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

const invalidateArticleCache = async (
  slug = null,
  sectionId = null,
  sectionSlug = null
) => {
  const patterns = [
    deleteCacheByPattern('articles:*'),
    deleteCacheByPattern('article:id:*'),
    deleteCacheByPattern('headline:*'),
    deleteCacheByPattern('category:*'),
    deleteCacheByPattern('search:*'),
    deleteCacheByPattern('similar:*'),
    deleteCacheByPattern('subcategory:*'),
    deleteCacheByPattern('topstories:*'),
    deleteCacheByPattern('breaking:*'),
    deleteCacheByPattern('comments:*'),
    deleteCacheByPattern('sections:*'),
    deleteCacheByPattern('section:*'),
    deleteCacheByPattern('articlefeed:*'),
    deleteCacheByPattern('articles:section:*'),
    deleteCacheByPattern('articles:feed:*'),
  ];

  if (slug) {
    patterns.push(deleteCacheByPattern(`article:${slug}`));
    patterns.push(deleteCacheByPattern(`article:comments:*`));
  }

  if (sectionId) {
    patterns.push(deleteCacheByPattern(`articles:section:id:${sectionId}:*`));
    patterns.push(deleteCacheByPattern(`articles:section:${sectionId}:*`));
  }

  if (sectionSlug) {
    patterns.push(
      deleteCacheByPattern(`articles:section:slug:${sectionSlug}:*`)
    );
  }

  await Promise.all(patterns);
};

const updateExpiredTopstories = async () => {
  try {
    const now = new Date();
    const expiredCount = await Article.updateMany(
      {
        isTopstory: true,
        breakingExpiresAt: { $lt: now },
      },
      {
        $set: { isTopstory: false },
      }
    ).modifiedCount;

    if (expiredCount > 0) {
      await deleteCacheByPattern('topstories:*');
      await deleteCacheByPattern('articles:*');
    }
    return expiredCount;
  } catch (err) {
    console.error('Error updating expired top stories:', err);
    return 0;
  }
};

const updateExpiredBreakingNews = async () => {
  try {
    const now = new Date();
    const expiredCount = await Article.updateMany(
      {
        isBreaking: true,
        breakingExpiresAt: { $lt: now },
      },
      {
        $set: { isBreaking: false, breakingExpiresAt: null },
      }
    ).modifiedCount;

    if (expiredCount > 0) {
      await deleteCacheByPattern('breaking:*');
      await deleteCacheByPattern('articles:*');
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
      section_id,
      section_name,
      section_code,
      section_slug,
      isLive,
      isBreaking,
      isTopstory,
      isHeadline,
      source_name,
      creator,
      image_url,
      published_at,
      meta_title,
      meta_description,
      slug,
    } = req.body;

    // Create document FIRST
    const article = new Article({
      title,
      description,
      content,
      category,
      subcategory,
      tags,
      section_id: section_id || null,
      section_name: section_name || null,
      section_code: section_code || null,
      section_slug: section_slug || null,
      isLive: isLive || false,
      wasLive: false,
      isBreaking: isBreaking || false,
      isTopstory: isTopstory || false,
      isHeadline: isHeadline || false,
      source_name: source_name || 'Ghanapolitan',
      creator: creator || 'Admin',
      image_url,
      published_at: published_at ? new Date(published_at) : Date.now(),
    });

    // ✅ USE INSTANCE METHODS (CORRECT)
    article.slug = slug || article.generateSlug(article.title);

    article.meta_title = meta_title || article.generateMetaTitle(article.title);

    article.meta_description =
      meta_description ||
      article.generateMetaDescription({
        title: article.title,
        description: article.description,
      });

    await article.save();

    return res.status(201).json({
      status: 'success',
      data: article,
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.slug) {
      return res.status(400).json({
        status: 'fail',
        message: 'Slug must be unique',
      });
    }

    return res.status(500).json({
      status: 'error',
      message: error.message,
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

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const oldSectionId = existingArticle.section_id;
    const newSectionId = updateData.section_id;

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
      await deleteCacheByPattern('headline:*');
    } else if (existingArticle.isHeadline && !updateData.isHeadline) {
      updateData.isHeadline = false;
    }

    if (updateData.isBreaking && !existingArticle.isBreaking) {
      updateData.breakingExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    } else if (!updateData.isBreaking && existingArticle.isBreaking) {
      updateData.breakingExpiresAt = null;
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

    if (updateData.section_name) {
      updateData.has_section = !!(
        updateData.section_name && updateData.section_name.trim() !== ''
      );
    } else if (!updateData.section_name || updateData.section_name === '') {
      updateData.has_section = false;
      updateData.section_id = null;
      updateData.section_code = null;
      updateData.section_slug = null;
    }

    const article = await Article.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (oldSectionId !== newSectionId) {
      if (oldSectionId) {
        const oldSection = await Section.findOne({ section_id: oldSectionId });
        if (oldSection) {
          oldSection.decrementArticlesCount();
          await oldSection.save();
        }
      }

      if (newSectionId) {
        const newSection = await Section.findOne({ section_id: newSectionId });
        if (newSection) {
          newSection.incrementArticlesCount();
          await newSection.save();
        }
      }
    }

    await invalidateArticleCache(article.slug, oldSectionId, newSectionId);

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

    const sectionId = article.section_id;

    if (article.image_url) {
      await deleteFromR2(article.image_url);
    }

    await article.deleteOne();

    if (sectionId) {
      const section = await Section.findOne({ section_id: sectionId });
      if (section) {
        section.decrementArticlesCount();
        await section.save();
      }
    }

    await invalidateArticleCache(article.slug, sectionId);

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

    const cacheKey = `article:id:${id}`;

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
    const cacheKey = `article:${slug}`;

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
    if (req.query.category) {
      query.category = req.query.category;
    }
    if (req.query.section_id) {
      query.section_id = req.query.section_id;
    }
    if (req.query.section_name) {
      query.section_name = req.query.section_name;
    }
    if (req.query.has_section !== undefined) {
      query.has_section = req.query.has_section === 'true';
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

exports.getArticlesBySection = async (req, res) => {
  try {
    const { sectionSlug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:section', {
      sectionSlug,
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

    const section = await Section.findBySlug(sectionSlug);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const [articles, total] = await Promise.all([
      Article.find({
        section_slug: sectionSlug,
        has_section: true,
      })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({
        section_slug: sectionSlug,
        has_section: true,
      }),
    ]);

    const responseData = {
      section: {
        id: section.section_id,
        name: section.section_name,
        description: section.section_description,
        slug: section.section_slug,
      },
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

exports.getArticleFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articlefeed', {
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

    const query = {
      has_section: false,
    };

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

exports.getArticleFeedByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articlefeed:category', {
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

    const query = {
      has_section: false,
      category: category,
    };

    const [articles, total] = await Promise.all([
      Article.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Article.countDocuments(query),
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

exports.getArticlesBySectionId = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:section:id', {
      sectionId,
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

    const section = await Section.findOne({ section_id: sectionId });
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const [articles, total] = await Promise.all([
      Article.find({ section_id: sectionId, has_section: true })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({ section_id: sectionId, has_section: true }),
    ]);

    const responseData = {
      section: {
        id: section.section_id,
        name: section.section_name,
        description: section.section_description,
      },
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

exports.getArticlesBySectionSlug = async (req, res) => {
  try {
    const { sectionSlug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:section:slug', {
      sectionSlug,
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

    const section = await Section.findBySlug(sectionSlug);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    await updateExpiredTopstories();
    await updateExpiredBreakingNews();

    const [articles, total] = await Promise.all([
      Article.find({ section_slug: sectionSlug, has_section: true })
        .sort({ published_at: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments({ section_slug: sectionSlug, has_section: true }),
    ]);

    const responseData = {
      section: {
        id: section.section_id,
        name: section.section_name,
        description: section.section_description,
        slug: section.section_slug,
      },
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

exports.getArticlesWithSections = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const cacheKey = `articles:withsections:${limit}`;

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

    const sections = await Section.find({ isActive: true })
      .sort({ displayOrder: 1, section_name: 1 })
      .limit(10);

    const articlesBySection = [];

    for (const section of sections) {
      const articles = await Article.find({
        section_slug: section.section_slug,
        has_section: true,
      })
        .sort({ published_at: -1 })
        .limit(limit);

      if (articles.length > 0) {
        articlesBySection.push({
          section: {
            id: section.section_id,
            name: section.section_name,
            slug: section.section_slug,
            description: section.section_description,
            image: section.section_image_url,
            color: section.section_color,
            articles_count: section.articles_count,
          },
          articles,
        });
      }
    }

    await setCache(cacheKey, articlesBySection, 300);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: articlesBySection,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getArticlesWithoutSection = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:without:section', {
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

    const query = {
      has_section: false,
    };

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

exports.assignArticleToSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, section_name, section_code, section_slug } = req.body;

    if (!section_id) {
      return res.status(400).json({
        status: 'fail',
        message: 'Section ID is required',
      });
    }

    const article = await Article.findById(id);
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const section = await Section.findOne({ section_id });
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    const oldSectionId = article.section_id;

    article.section_id = section_id;
    article.section_name = section_name || section.section_name;
    article.section_code = section_code || section.section_code;
    article.section_slug = section_slug || section.section_slug;
    article.has_section = true;
    await article.save();

    if (oldSectionId) {
      const oldSection = await Section.findOne({ section_id: oldSectionId });
      if (oldSection) {
        oldSection.decrementArticlesCount();
        await oldSection.save();
      }
    }

    section.incrementArticlesCount();
    await section.save();

    await invalidateArticleCache(article.slug, oldSectionId, section_id);

    res.status(200).json({
      status: 'success',
      data: { article },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.removeArticleFromSection = async (req, res) => {
  try {
    const { id } = req.params;

    const article = await Article.findById(id);
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const sectionId = article.section_id;

    if (!sectionId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Article is not assigned to any section',
      });
    }

    article.section_id = null;
    article.section_name = null;
    article.section_code = null;
    article.section_slug = null;
    article.has_section = false;
    await article.save();

    const section = await Section.findOne({ section_id: sectionId });
    if (section) {
      section.decrementArticlesCount();
      await section.save();
    }

    await invalidateArticleCache(article.slug, sectionId);

    res.status(200).json({
      status: 'success',
      data: { article },
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
          { section_name: { $regex: searchRegex } },
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
          { section_name: { $regex: searchRegex } },
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
    const cacheKey = 'headline:current';
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
    const cacheKey = `topstories:${limit}`;

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
    const cacheKey = `breaking:${limit}`;

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

exports.getComments = async (req, res) => {
  try {
    const { slug } = req.params;
    const { sort = 'newest', page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const cacheKey = `comments:${slug}:${sort}:${page}:${limit}`;
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const article = await Article.findOne({ slug }).select('comments');
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    let sortedComments = [...article.comments];

    switch (sort) {
      case 'newest':
        sortedComments.sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        break;
      case 'oldest':
        sortedComments.sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        break;
      case 'top':
        sortedComments.sort(
          (a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes)
        );
        break;
      case 'controversial':
        sortedComments.sort(
          (a, b) => b.downvotes + b.upvotes - (a.downvotes + a.upvotes)
        );
        break;
    }

    const paginatedComments = sortedComments.slice(
      skip,
      skip + parseInt(limit)
    );
    const total = article.comments.length;

    const responseData = {
      slug,
      sort,
      results: paginatedComments.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: { comments: paginatedComments },
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

exports.addComment = async (req, res) => {
  try {
    const { slug } = req.params;
    const { username, content } = req.body;

    if (!username || !content) {
      return res.status(400).json({
        status: 'fail',
        message: 'Username and content are required',
      });
    }

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    if (article.isLive) {
      return res.status(400).json({
        status: 'fail',
        message: 'Live articles cannot have comments',
      });
    }

    const newComment = article.addComment(username, content);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(201).json({
      status: 'success',
      data: { comment: newComment },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.addReply = async (req, res) => {
  try {
    const { slug, commentId } = req.params;
    const { username, content } = req.body;

    if (!username || !content) {
      return res.status(400).json({
        status: 'fail',
        message: 'Username and content are required',
      });
    }

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    if (article.isLive) {
      return res.status(400).json({
        status: 'fail',
        message: 'Live articles cannot have comments or replies',
      });
    }

    const newReply = article.addReply(commentId, username, content);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(201).json({
      status: 'success',
      data: { reply: newReply },
    });
  } catch (err) {
    if (err.message === 'Comment not found') {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.upvoteComment = async (req, res) => {
  try {
    const { slug, commentId } = req.params;
    const voterId =
      req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const comment = article.upvoteComment(commentId, voterId);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      data: { comment },
    });
  } catch (err) {
    if (err.message === 'Comment not found') {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.downvoteComment = async (req, res) => {
  try {
    const { slug, commentId } = req.params;
    const voterId =
      req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const comment = article.downvoteComment(commentId, voterId);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      data: { comment },
    });
  } catch (err) {
    if (err.message === 'Comment not found') {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.upvoteReply = async (req, res) => {
  try {
    const { slug, commentId, replyId } = req.params;
    const voterId =
      req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const reply = article.upvoteReply(commentId, replyId, voterId);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      data: { reply },
    });
  } catch (err) {
    if (
      err.message === 'Comment not found' ||
      err.message === 'Reply not found'
    ) {
      return res.status(404).json({
        status: 'fail',
        message: err.message,
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.downvoteReply = async (req, res) => {
  try {
    const { slug, commentId, replyId } = req.params;
    const voterId =
      req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const reply = article.downvoteReply(commentId, replyId, voterId);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      data: { reply },
    });
  } catch (err) {
    if (
      err.message === 'Comment not found' ||
      err.message === 'Reply not found'
    ) {
      return res.status(404).json({
        status: 'fail',
        message: err.message,
      });
    }
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.editComment = async (req, res) => {
  try {
    const { slug, commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        status: 'fail',
        message: 'Content is required',
      });
    }

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const comment = article.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }

    comment.content = content;
    comment.isEdited = true;
    comment.editedAt = new Date();
    comment.updatedAt = new Date();

    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      data: { comment },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.editReply = async (req, res) => {
  try {
    const { slug, commentId, replyId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        status: 'fail',
        message: 'Content is required',
      });
    }

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const comment = article.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }

    const reply = comment.replies.id(replyId);
    if (!reply) {
      return res.status(404).json({
        status: 'fail',
        message: 'Reply not found',
      });
    }

    reply.content = content;
    reply.isEdited = true;
    reply.editedAt = new Date();
    reply.updatedAt = new Date();

    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      data: { reply },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { slug, commentId } = req.params;

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const commentIndex = article.comments.findIndex(
      (comment) => comment._id.toString() === commentId
    );
    if (commentIndex === -1) {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }

    article.comments.splice(commentIndex, 1);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      message: 'Comment deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.deleteReply = async (req, res) => {
  try {
    const { slug, commentId, replyId } = req.params;

    const article = await Article.findOne({ slug });
    if (!article) {
      return res.status(404).json({
        status: 'fail',
        message: 'Article not found',
      });
    }

    const comment = article.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({
        status: 'fail',
        message: 'Comment not found',
      });
    }

    const replyIndex = comment.replies.findIndex(
      (reply) => reply._id.toString() === replyId
    );
    if (replyIndex === -1) {
      return res.status(404).json({
        status: 'fail',
        message: 'Reply not found',
      });
    }

    comment.replies.splice(replyIndex, 1);
    await article.save();

    await invalidateArticleCache(slug);
    await deleteCacheByPattern(`comments:${slug}:*`);

    res.status(200).json({
      status: 'success',
      message: 'Reply deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getArticlesWithoutSectionByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:without:section:category', {
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

    const query = {
      has_section: false,
      category: category,
    };

    const [articles, total] = await Promise.all([
      Article.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Article.countDocuments(query),
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

exports.getArticlesWithoutSectionBySubcategory = async (req, res) => {
  try {
    const { subcategory } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('articles:without:section:subcategory', {
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

    const query = {
      has_section: false,
      subcategory: { $in: [subcategory] },
    };

    const [articles, total] = await Promise.all([
      Article.find(query).sort({ published_at: -1 }).skip(skip).limit(limit),
      Article.countDocuments(query),
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
