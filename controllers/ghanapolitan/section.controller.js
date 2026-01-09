const Section = require('../../models/ghanapolitan/section.model');
const { Article } = require('../../models/ghanapolitan/article.model');
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

const invalidateSectionCache = async (slug = null, code = null) => {
  const patterns = [
    deleteCacheByPattern('sections:*'),
    deleteCacheByPattern('section:id:*'),
    deleteCacheByPattern('section:slug:*'),
    deleteCacheByPattern('section:code:*'),
    deleteCacheByPattern('sections:important:*'),
    deleteCacheByPattern('sections:active:*'),
    deleteCacheByPattern('sections:tags:*'),
    deleteCacheByPattern('sections:category:*'),
    deleteCacheByPattern('sections:expiring:*'),
  ];

  if (slug) {
    patterns.push(deleteCacheByPattern(`section:${slug}`));
    patterns.push(deleteCacheByPattern(`articles:section:slug:${slug}:*`));
  }
  if (code) {
    patterns.push(deleteCacheByPattern(`section:code:${code}`));
  }

  await Promise.all(patterns);
};

// Helper function to update section articles count
const updateSectionArticlesCount = async (sectionSlug) => {
  try {
    if (!sectionSlug) return;

    const section = await Section.findOne({ section_slug: sectionSlug });
    if (!section) return;

    // Count articles assigned to this section
    const articlesCount = await Article.countDocuments({
      section_slug: sectionSlug,
      has_section: true,
    });

    // Update the section's articles_count
    section.articles_count = articlesCount;
    await section.save();

    // Invalidate cache
    await invalidateSectionCache(sectionSlug);

    return articlesCount;
  } catch (err) {
    console.error('Error updating section articles count:', err);
  }
};

exports.createSection = async (req, res) => {
  try {
    const {
      section_name,
      section_code,
      section_slug,
      section_description,
      isSectionImportant,
      tags,
      category,
      subcategory,
      displayOrder,
      meta_title,
      meta_description,
      section_color,
      section_background_color,
      createdBy,
      expires_at,
    } = req.body;

    if (!section_name || !section_code) {
      return res.status(400).json({
        status: 'fail',
        message: 'Section name and code are required',
      });
    }

    const existingSectionCode = await Section.findOne({ section_code });
    if (existingSectionCode) {
      return res.status(400).json({
        status: 'fail',
        message: 'Section code already exists',
      });
    }

    let imageUrl = null;
    if (req.files?.image?.[0]) {
      imageUrl = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'sections'
      );
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

    let expiresAt = null;
    if (expires_at) {
      expiresAt = new Date(expires_at);
      if (isNaN(expiresAt.getTime())) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid expiration date format',
        });
      }
    }

    let sectionSlug = section_slug;
    if (!sectionSlug) {
      sectionSlug = Section.prototype.generateSlug(section_name);
    }

    const existingSlug = await Section.findOne({ section_slug: sectionSlug });
    if (existingSlug) {
      return res.status(400).json({
        status: 'fail',
        message: 'Section slug already exists',
      });
    }

    const section = new Section({
      section_name,
      section_code,
      section_slug: sectionSlug,
      section_description,
      isSectionImportant: isSectionImportant || false,
      expires_at: expiresAt,
      tags: processedTags,
      category,
      subcategory: processedSubcategory,
      displayOrder: displayOrder || 0,
      meta_title,
      meta_description,
      section_image_url: imageUrl,
      section_color: section_color || '#000000',
      section_background_color: section_background_color,
      createdBy: createdBy || 'Admin',
      isActive: true,
      articles_count: 0, // Start with 0, will be updated by articles
      featured_articles: [],
    });

    await section.save();
    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(201).json({
      status: 'success',
      data: { section },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        status: 'fail',
        message: 'Section slug or code must be unique',
      });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({
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

exports.updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingSection = await Section.findById(id);

    if (!existingSection) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    if (req.files?.image?.[0]) {
      if (existingSection.section_image_url) {
        await deleteFromR2(existingSection.section_image_url);
      }
      updateData.section_image_url = await uploadToR2(
        req.files.image[0].buffer,
        req.files.image[0].mimetype,
        'sections'
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

    if (updateData.expires_at) {
      updateData.expires_at = new Date(updateData.expires_at);
      if (isNaN(updateData.expires_at.getTime())) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid expiration date format',
        });
      }
    }

    if (
      updateData.section_name &&
      updateData.section_name !== existingSection.section_name
    ) {
      updateData.section_slug = Section.prototype.generateSlug(
        updateData.section_name
      );
    }

    updateData.updatedBy = updateData.updatedBy || 'Admin';
    updateData.updatedAt = new Date();

    const section = await Section.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: { section },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        status: 'fail',
        message: 'Section slug or code must be unique',
      });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({
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

exports.deleteSection = async (req, res) => {
  try {
    const { id } = req.params;

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    // First, remove this section from all articles that reference it
    await Article.updateMany(
      { section_slug: section.section_slug },
      {
        $set: {
          has_section: false,
          section_slug: null,
          section_name: null,
          section_code: null,
        },
      }
    );

    if (section.section_image_url) {
      await deleteFromR2(section.section_image_url);
    }

    await section.deleteOne();
    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      message: 'Section deleted successfully',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getSectionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid section ID format',
      });
    }

    const cacheKey = `section:id:${id}`;
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { section: cachedData },
      });
    }

    const section = await Section.findById(id);

    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    // Update articles count before returning
    const articlesCount = await Article.countDocuments({
      section_slug: section.section_slug,
      has_section: true,
    });

    // Only update if different
    if (section.articles_count !== articlesCount) {
      section.articles_count = articlesCount;
      await section.save();
      await invalidateSectionCache(section.section_slug);
    }

    const responseData = section.toObject();
    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { section: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getSectionBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `section:slug:${slug}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { section: cachedData },
      });
    }

    const section = await Section.findBySlug(slug);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    // Update articles count before returning
    const articlesCount = await Article.countDocuments({
      section_slug: slug,
      has_section: true,
    });

    // Only update if different
    if (section.articles_count !== articlesCount) {
      section.articles_count = articlesCount;
      await section.save();
      await invalidateSectionCache(slug);
    }

    const responseData = section.toObject();
    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { section: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getSectionByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const cacheKey = `section:code:${code}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { section: cachedData },
      });
    }

    const section = await Section.findByCode(code);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    // Update articles count before returning
    const articlesCount = await Article.countDocuments({
      section_slug: section.section_slug,
      has_section: true,
    });

    // Only update if different
    if (section.articles_count !== articlesCount) {
      section.articles_count = articlesCount;
      await section.save();
      await invalidateSectionCache(section.section_slug);
    }

    const responseData = section.toObject();
    await setCache(cacheKey, responseData, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { section: responseData },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getAllSections = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const q = req.query.q || req.query.search;
    const isActive = req.query.isActive;
    const isSectionImportant = req.query.isSectionImportant;
    const category = req.query.category;
    const tags = req.query.tags;
    const sortBy = req.query.sortBy || 'displayOrder';
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;

    const cacheKey = generateCacheKey('sections:all', {
      q,
      page,
      limit,
      isActive,
      isSectionImportant,
      category,
      tags,
      sortBy,
      sortOrder: req.query.sortOrder || 'asc',
    });

    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        ...cachedData,
      });
    }

    const query = {};

    if (q && q.trim() !== '') {
      const searchRegex = new RegExp(q.trim(), 'i');
      query.$or = [
        { section_name: searchRegex },
        { section_description: searchRegex },
        { section_code: searchRegex },
        { category: searchRegex },
        { section_slug: searchRegex },
        { tags: { $elemMatch: { $regex: searchRegex } } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (isSectionImportant !== undefined) {
      query.isSectionImportant = isSectionImportant === 'true';
    }

    if (category) {
      query.category = category;
    }

    if (tags) {
      const tagArray = tags.split(',').map((tag) => tag.trim());
      query.tags = { $in: tagArray };
    }

    const [sections, total] = await Promise.all([
      Section.find(query)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit),
      Section.countDocuments(query),
    ]);

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    const responseData = {
      query: q,
      results: sections.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { sections },
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

exports.getImportantSections = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `sections:important:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { sections: cachedData },
      });
    }

    const sections = await Section.findImportantSections().limit(limit);

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    await setCache(cacheKey, sections, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { sections },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getActiveSections = async (req, res) => {
  try {
    const cacheKey = 'sections:active';

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { sections: cachedData },
      });
    }

    const sections = await Section.findAllActive();

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    await setCache(cacheKey, sections, 1800);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { sections },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getSectionsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cacheKey = generateCacheKey('sections:category', {
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

    const [sections, total] = await Promise.all([
      Section.find({ category, isActive: true })
        .sort({ displayOrder: 1, section_name: 1 })
        .skip(skip)
        .limit(limit),
      Section.countDocuments({ category, isActive: true }),
    ]);

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    const responseData = {
      category,
      results: sections.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { sections },
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

exports.getSectionsByTags = async (req, res) => {
  try {
    const { tags } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (!tags) {
      return res.status(400).json({
        status: 'fail',
        message: 'Tags query parameter is required',
      });
    }

    const tagArray = tags.split(',').map((tag) => tag.trim());
    const cacheKey = generateCacheKey('sections:tags', {
      tags: tagArray.join(','),
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

    const [sections, total] = await Promise.all([
      Section.findByTags(tagArray).skip(skip).limit(limit),
      Section.countDocuments({
        tags: { $in: tagArray },
        isActive: true,
      }),
    ]);

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    const responseData = {
      tags: tagArray,
      results: sections.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { sections },
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

exports.searchSections = async (req, res) => {
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

    const cacheKey = generateCacheKey('sections:search', {
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

    const [sections, total] = await Promise.all([
      Section.find({
        isActive: true,
        $or: [
          { section_name: { $regex: searchRegex } },
          { section_description: { $regex: searchRegex } },
          { section_code: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $elemMatch: { $regex: searchRegex } } },
        ],
      })
        .sort({ displayOrder: 1, section_name: 1 })
        .skip(skip)
        .limit(limit),
      Section.countDocuments({
        isActive: true,
        $or: [
          { section_name: { $regex: searchRegex } },
          { section_description: { $regex: searchRegex } },
          { section_code: { $regex: searchRegex } },
          { category: { $regex: searchRegex } },
          { tags: { $elemMatch: { $regex: searchRegex } } },
        ],
      }),
    ]);

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    const responseData = {
      query: q,
      results: sections.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: { sections },
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

exports.addFeaturedArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const { articleId } = req.body;

    if (!articleId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Article ID is required',
      });
    }

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.addFeaturedArticle(articleId);
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: { section },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.removeFeaturedArticle = async (req, res) => {
  try {
    const { id, articleId } = req.params;

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.removeFeaturedArticle(articleId);
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: { section },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

// These functions are now handled automatically by the updateSectionArticlesCount function
exports.incrementArticlesCount = async (req, res) => {
  try {
    const { slug } = req.params;

    const articlesCount = await updateSectionArticlesCount(slug);

    res.status(200).json({
      status: 'success',
      data: { articles_count: articlesCount },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.decrementArticlesCount = async (req, res) => {
  try {
    const { slug } = req.params;

    const articlesCount = await updateSectionArticlesCount(slug);

    res.status(200).json({
      status: 'success',
      data: { articles_count: articlesCount },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.addTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({
        status: 'fail',
        message: 'Tag is required',
      });
    }

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.addTag(tag);
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: { tags: section.tags },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.removeTag = async (req, res) => {
  try {
    const { id, tag } = req.params;

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.removeTag(tag);
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: { tags: section.tags },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.toggleImportance = async (req, res) => {
  try {
    const { id } = req.params;

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.isSectionImportant = !section.isSectionImportant;
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: {
        section,
        isSectionImportant: section.isSectionImportant,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.toggleActiveStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.isActive = !section.isActive;
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: {
        section,
        isActive: section.isActive,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.getExpiringSections = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const cacheKey = `sections:expiring:${days}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: 'success',
        cached: true,
        data: { sections: cachedData },
      });
    }

    const sections = await Section.findExpiringSoon(days);

    // Update articles count for each section
    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        await invalidateSectionCache(section.section_slug);
      }
    }

    await setCache(cacheKey, sections, 3600);

    res.status(200).json({
      status: 'success',
      cached: false,
      data: { sections },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.extendExpiration = async (req, res) => {
  try {
    const { id } = req.params;
    const { days } = req.body;

    if (!days || days <= 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'Number of days is required and must be positive',
      });
    }

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    const newExpiration = section.extendExpiration(parseInt(days));
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: {
        section,
        expires_at: newExpiration,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.setExpiration = async (req, res) => {
  try {
    const { id } = req.params;
    const { expires_at } = req.body;

    if (!expires_at) {
      return res.status(400).json({
        status: 'fail',
        message: 'Expiration date is required',
      });
    }

    const expirationDate = new Date(expires_at);
    if (isNaN(expirationDate.getTime())) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid expiration date format',
      });
    }

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.setExpiration(expirationDate);
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: {
        section,
        expires_at: expirationDate,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

exports.removeExpiration = async (req, res) => {
  try {
    const { id } = req.params;

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({
        status: 'fail',
        message: 'Section not found',
      });
    }

    section.expires_at = null;
    await section.save();

    await invalidateSectionCache(section.section_slug, section.section_code);

    res.status(200).json({
      status: 'success',
      data: {
        section,
        message: 'Expiration removed, section will not auto-expire',
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};

// New function to manually sync articles count for all sections
exports.syncArticlesCount = async (req, res) => {
  try {
    const sections = await Section.find({ isActive: true });
    let updatedCount = 0;

    for (const section of sections) {
      const articlesCount = await Article.countDocuments({
        section_slug: section.section_slug,
        has_section: true,
      });

      if (section.articles_count !== articlesCount) {
        section.articles_count = articlesCount;
        await section.save();
        updatedCount++;
      }
    }

    // Invalidate all section caches
    await invalidateSectionCache();

    res.status(200).json({
      status: 'success',
      data: {
        message: `Articles count synced for ${updatedCount} sections`,
        updatedCount,
        totalSections: sections.length,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};
