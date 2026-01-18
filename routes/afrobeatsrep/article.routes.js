const express = require('express');
const router = express.Router();
const articleController = require('../../controllers/afrobeatsrep/article.controller');
const upload = require('../../middleware/upload');

router.post(
  '/',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  articleController.createArticle
);

router.get('/', articleController.getAllArticles);

router.get('/search', articleController.searchArticles);

router.get('/headline/current', articleController.getHeadline);

router.get('/recent', articleController.getRecentArticles);

router.get('/featured', articleController.getFeaturedContent);

router.get('/category/:category', articleController.getArticlesByCategory);

router.get(
  '/subcategory/:subcategory',
  articleController.getArticlesBySubcategory
);

router.get('/label/:label', articleController.getArticlesByLabel);

router.get('/similar/:slug', articleController.getSimilarArticles);

router.get('/slug/:slug', articleController.getArticleBySlug);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  articleController.updateArticle
);

router.delete('/:id', articleController.deleteArticle);

router.get('/:id', articleController.getArticleById);

module.exports = router;
