const express = require('express');
const router = express.Router();
const chartController = require('../../controllers/ghanapolitan/chart.controller');
const { body, param, query } = require('express-validator');

// Validation middleware
const validateChart = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('chart_type').isIn(
    Object.values(require('../../models/ghanapolitan/chart.model').CHART_TYPES)
  ),
  body('chart_data').isArray().withMessage('Chart data must be an array'),
  body('data_schema.columns')
    .isArray()
    .withMessage('Data schema columns must be an array'),
  body('category').trim().notEmpty().withMessage('Category is required'),
];

// Public routes
router.get('/types', chartController.getChartTypes);
router.get('/data-types', chartController.getDataTypes);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('chart_type')
      .optional()
      .isIn(
        Object.values(
          require('../../models/ghanapolitan/chart.model').CHART_TYPES
        )
      ),
    query('status').optional().isIn(['draft', 'published', 'archived']),
    query('sort')
      .optional()
      .isIn([
        'published_at',
        '-published_at',
        'title',
        '-title',
        'views',
        '-views',
      ]),
  ],
  chartController.listCharts
);

router.get(
  '/:id',
  param('id').notEmpty().withMessage('Chart ID or slug is required'),
  chartController.getChart
);

router.get(
  '/:id/config',
  param('id').notEmpty().withMessage('Chart ID or slug is required'),
  chartController.getChartConfig
);

router.get(
  '/:id/data',
  param('id').notEmpty().withMessage('Chart ID or slug is required'),
  chartController.getChartData
);

// Protected routes (require authentication)
router.post('/', validateChart, chartController.createChart);

router.put(
  '/:id',
  param('id').isMongoId().withMessage('Invalid chart ID'),
  validateChart,
  chartController.updateChart
);

router.delete(
  '/:id',
  param('id').isMongoId().withMessage('Invalid chart ID'),
  chartController.deleteChart
);

// CSV Import route
router.post(
  '/import/csv',
  [
    body('csvData').isArray().withMessage('CSV data must be an array'),
    body('schema.columns')
      .isArray()
      .withMessage('Schema columns must be an array'),
  ],
  chartController.importCSVData
);

// Batch operations
router.post(
  '/batch/publish',
  [
    body('chartIds').isArray().withMessage('Chart IDs must be an array'),
    body('chartIds.*').isMongoId().withMessage('Invalid chart ID'),
  ],
  async (req, res) => {
    try {
      const { chartIds } = req.body;
      const result = await Chart.updateMany(
        { _id: { $in: chartIds } },
        {
          $set: {
            status: 'published',
            published_at: new Date(),
          },
        }
      );

      res.status(200).json({
        success: true,
        message: `${result.modifiedCount} charts published successfully`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Get charts by category
router.get(
  '/category/:category',
  [
    param('category').notEmpty(),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  async (req, res) => {
    try {
      const { category } = req.params;
      const limit = parseInt(req.query.limit) || 10;

      const charts = await Chart.find({
        category,
        status: 'published',
      })
        .sort('-published_at')
        .limit(limit)
        .select('title slug description category featured_image published_at');

      res.status(200).json({
        success: true,
        data: charts,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Get popular charts
router.get(
  '/popular/:limit?',
  param('limit').optional().isInt({ min: 1, max: 50 }),
  async (req, res) => {
    try {
      const limit = parseInt(req.params.limit) || 10;

      const charts = await Chart.find({ status: 'published' })
        .sort('-views')
        .limit(limit)
        .select('title slug description category views published_at');

      res.status(200).json({
        success: true,
        data: charts,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Search charts
router.get(
  '/search/:query',
  [
    param('query').notEmpty(),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  async (req, res) => {
    try {
      const { query } = req.params;
      const limit = parseInt(req.query.limit) || 20;

      const charts = await Chart.find({
        $text: { $search: query },
        status: 'published',
      })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .select('title slug description category score');

      res.status(200).json({
        success: true,
        data: charts,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

module.exports = router;
