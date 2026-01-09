const express = require('express');
const router = express.Router();
const opinionController = require('../../controllers/ghanapolitan/opinion.controller');
const upload = require('../../middleware/upload');

router.post(
  '/',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  opinionController.createOpinion
);

router.put(
  '/:id',
  upload.fields([{ name: 'image', maxCount: 1 }]),
  opinionController.updateOpinion
);

router.delete('/:id', opinionController.deleteOpinion);

router.get('/slug/:slug', opinionController.getOpinionBySlug);

router.get('/', opinionController.getAllOpinions);

router.get('/category/:category', opinionController.getOpinionsByCategory);

router.get('/similar/:slug', opinionController.getSimilarOpinions);

router.get('/search', opinionController.searchOpinions);

router.get('/recent', opinionController.getRecentOpinions);

router.get('/featured', opinionController.getFeaturedOpinions);

module.exports = router;
