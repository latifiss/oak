const express = require('express');
const router = express.Router();
const graphicController = require('../../controllers/ghanapolitan/graphic.controller');
const upload = require('../../middleware/upload');

router.post(
  '/',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  graphicController.createGraphic
);

router.get('/', graphicController.getAllGraphics);

router.get('/search', graphicController.searchGraphics);

router.get('/recent', graphicController.getRecentGraphics);

router.get('/featured', graphicController.getFeaturedContent);

router.get('/category/:category', graphicController.getGraphicsByCategory);

router.get(
  '/subcategory/:subcategory',
  graphicController.getGraphicsBySubcategory
);

router.get('/similar/:slug', graphicController.getSimilarGraphics);

router.get('/slug/:slug', graphicController.getGraphicBySlug);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  graphicController.updateGraphic
);

router.delete('/:id', graphicController.deleteGraphic);

router.get('/:id', graphicController.getGraphicById);

module.exports = router;
