const express = require('express');
const router = express.Router();
const articleController = require('../../controllers/ghanapolitan/article.controller');
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

router.get('/feed', articleController.getArticleFeed);

router.get(
  '/feed/category/:category',
  articleController.getArticleFeedByCategory
);

router.get('/with-sections', articleController.getArticlesWithSections);
router.get('/without-section', articleController.getArticlesWithoutSection);
router.get(
  '/without-section-by-category/:category',
  articleController.getArticlesWithoutSectionByCategory
);
router.get(
  '/without-section-by-subcategory/:subcategory',
  articleController.getArticlesWithoutSectionBySubcategory
);

router.get('/section/:sectionSlug', articleController.getArticlesBySection);

router.get('/section/id/:sectionId', articleController.getArticlesBySectionId);
router.get(
  '/section/slug/:sectionSlug',
  articleController.getArticlesBySectionSlug
);

router.get('/category/:category', articleController.getArticlesByCategory);

router.get(
  '/subcategory/:subcategory',
  articleController.getArticlesBySubcategory
);

router.get('/similar/:slug', articleController.getSimilarArticles);

router.get('/slug/:slug', articleController.getArticleBySlug);

router.get('/:slug/comments', articleController.getComments);
router.post('/:slug/comments', articleController.addComment);
router.put('/:slug/comments/:commentId', articleController.editComment);
router.delete('/:slug/comments/:commentId', articleController.deleteComment);

router.post('/:slug/comments/:commentId/replies', articleController.addReply);
router.put(
  '/:slug/comments/:commentId/replies/:replyId',
  articleController.editReply
);
router.delete(
  '/:slug/comments/:commentId/replies/:replyId',
  articleController.deleteReply
);

router.post(
  '/:slug/comments/:commentId/upvote',
  articleController.upvoteComment
);
router.post(
  '/:slug/comments/:commentId/downvote',
  articleController.downvoteComment
);
router.post(
  '/:slug/comments/:commentId/replies/:replyId/upvote',
  articleController.upvoteReply
);
router.post(
  '/:slug/comments/:commentId/replies/:replyId/downvote',
  articleController.downvoteReply
);

router.post('/:id/assign-section', articleController.assignArticleToSection);
router.post('/:id/remove-section', articleController.removeArticleFromSection);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  articleController.updateArticle
);

router.delete('/:id', articleController.deleteArticle);

router.get('/:id', articleController.getArticleById);

router.get('/status/:status', articleController.getArticlesByStatus);

module.exports = router;
