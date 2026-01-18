const express = require('express');
const router = express.Router();
const articleController = require('../../controllers/ghanascore/article.controller');
const upload = require('../../middleware/upload');

router.post(
  '/',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  articleController.createArticle
);

router.get('/', articleController.getAllArticles);

router.get('/search', articleController.searchArticles);

router.get('/headline/current', articleController.getHeadline);

router.get('/breaking', articleController.getBreakingNews);
router.get('/live', articleController.getLiveArticles);

router.get('/top-stories', articleController.getTopStories);

router.get('/status/:status', articleController.getArticlesByStatus);
router.get(
  '/top-stories/category/:category',
  articleController.getTopStoriesByCategory
);
router.get('/top-stories/recent', articleController.getRecentTopStories);

router.get('/category/:category', articleController.getArticlesByCategory);

router.get(
  '/subcategory/:subcategory',
  articleController.getArticlesBySubcategory
);

router.get('/similar/:slug', articleController.getSimilarArticles);

router.get('/slug/:slug', articleController.getArticleBySlug);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  articleController.updateArticle
);

router.delete('/:id', articleController.deleteArticle);

router.get('/:id', articleController.getArticleById);

router.get('/status/:status', articleController.getArticlesByStatus);

module.exports = router;
