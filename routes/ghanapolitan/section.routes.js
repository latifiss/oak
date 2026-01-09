const express = require('express');
const router = express.Router();
const sectionController = require('../../controllers/ghanapolitan/section.controller');
const upload = require('../../middleware/upload');

// Existing routes (unchanged)
router.post(
  '/',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  sectionController.createSection
);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  sectionController.updateSection
);

router.delete('/:id', sectionController.deleteSection);

router.get('/id/:id', sectionController.getSectionById);

router.get('/slug/:slug', sectionController.getSectionBySlug);

router.get('/code/:code', sectionController.getSectionByCode);

router.get('/', sectionController.getAllSections);

router.get('/important', sectionController.getImportantSections);

router.get('/active', sectionController.getActiveSections);

router.get('/category/:category', sectionController.getSectionsByCategory);

router.get('/tags', sectionController.getSectionsByTags);

router.get('/search', sectionController.searchSections);

router.get('/expiring', sectionController.getExpiringSections);

router.post('/:id/featured', sectionController.addFeaturedArticle);

router.delete(
  '/:id/featured/:articleId',
  sectionController.removeFeaturedArticle
);

router.post(
  '/:id/articles/increment',
  sectionController.incrementArticlesCount
);

router.post(
  '/:id/articles/decrement',
  sectionController.decrementArticlesCount
);

router.post('/:id/tags', sectionController.addTag);

router.delete('/:id/tags/:tag', sectionController.removeTag);

router.patch('/:id/toggle-importance', sectionController.toggleImportance);

router.patch('/:id/toggle-active', sectionController.toggleActiveStatus);

router.post('/:id/extend-expiration', sectionController.extendExpiration);

router.post('/:id/set-expiration', sectionController.setExpiration);

router.delete('/:id/expiration', sectionController.removeExpiration);

// NEW ROUTES ADDED BELOW (keeping all existing routes unchanged)

// New article count routes using slug (complementary to existing id-based routes)
router.post(
  '/slug/:slug/articles/increment',
  sectionController.incrementArticlesCount
);

router.post(
  '/slug/:slug/articles/decrement',
  sectionController.decrementArticlesCount
);

// New sync articles count route
router.post('/sync/articles-count', sectionController.syncArticlesCount);

module.exports = router;
