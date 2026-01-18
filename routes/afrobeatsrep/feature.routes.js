const express = require('express');
const router = express.Router();
const featureController = require('../../controllers/afrobeatsrep/feature.controller');
const upload = require('../../middleware/upload');

router.post(
  '/',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  featureController.createFeature
);

router.get('/', featureController.getAllFeatures);

router.get('/search', featureController.searchFeatures);

router.get('/recent', featureController.getRecentFeatures);

router.get('/featured', featureController.getFeaturedContent);

router.get('/category/:category', featureController.getFeaturesByCategory);

router.get(
  '/subcategory/:subcategory',
  featureController.getFeaturesBySubcategory
);

router.get('/similar/:slug', featureController.getSimilarFeatures);

router.get('/slug/:slug', featureController.getFeatureBySlug);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  featureController.updateFeature
);

router.delete('/:id', featureController.deleteFeature);

router.get('/:id', featureController.getFeatureById);

module.exports = router;
