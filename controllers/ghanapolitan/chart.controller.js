const {
  Chart,
  CHART_TYPES,
  DATA_TYPES,
} = require('../../models/ghanapolitan/chart.model');
const { validationResult } = require('express-validator');

exports.createChart = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      chart_type,
      chart_data,
      data_schema,
      category,
      chart_config = {},
      display_config = {},
    } = req.body;

    // Validate chart type
    if (!Object.values(CHART_TYPES).includes(chart_type)) {
      return res.status(400).json({
        error: `Invalid chart type. Must be one of: ${Object.values(
          CHART_TYPES
        ).join(', ')}`,
      });
    }

    // Validate data structure based on chart type
    if (!this.validateChartData(chart_type, chart_data, data_schema)) {
      return res.status(400).json({
        error:
          'Chart data does not match the specified schema or chart type requirements',
      });
    }

    const chart = new Chart({
      title,
      description,
      chart_type,
      chart_data,
      data_schema,
      chart_config,
      display_config,
      category,
      subcategories: req.body.subcategories || [],
      tags: req.body.tags || [],
      creator: {
        name: req.user?.name || 'Admin',
        email: req.user?.email,
        avatar: req.user?.avatar,
      },
      status: req.body.status || 'draft',
      content: req.body.content || {},
      featured_image: req.body.featured_image,
      source_files: req.body.source_files || [],
    });

    await chart.save();

    res.status(201).json({
      success: true,
      data: chart,
      message: 'Chart created successfully',
    });
  } catch (error) {
    console.error('Error creating chart:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getChart = async (req, res) => {
  try {
    const chart = await Chart.findOne({
      $or: [{ _id: req.params.id }, { slug: req.params.id }],
    });

    if (!chart) {
      return res.status(404).json({
        success: false,
        error: 'Chart not found',
      });
    }

    // Increment views
    chart.views += 1;
    await chart.save();

    res.status(200).json({
      success: true,
      data: chart,
    });
  } catch (error) {
    console.error('Error fetching chart:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.updateChart = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = req.body;

    // Don't allow slug changes through regular updates
    if (updates.slug) {
      delete updates.slug;
    }

    const chart = await Chart.findOneAndUpdate(
      { _id: req.params.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!chart) {
      return res.status(404).json({
        success: false,
        error: 'Chart not found',
      });
    }

    res.status(200).json({
      success: true,
      data: chart,
      message: 'Chart updated successfully',
    });
  } catch (error) {
    console.error('Error updating chart:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.deleteChart = async (req, res) => {
  try {
    const chart = await Chart.findById(req.params.id);

    if (!chart) {
      return res.status(404).json({
        success: false,
        error: 'Chart not found',
      });
    }

    // Soft delete by archiving
    chart.status = 'archived';
    await chart.save();

    res.status(200).json({
      success: true,
      message: 'Chart archived successfully',
    });
  } catch (error) {
    console.error('Error deleting chart:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.listCharts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = '-published_at',
      chart_type,
      category,
      tag,
      status = 'published',
      search,
      year,
      month,
    } = req.query;

    const query = {};

    // Filter by status (admin can see all, public only sees published)
    if (req.user?.role === 'admin') {
      if (status) query.status = status;
    } else {
      query.status = 'published';
    }

    // Apply filters
    if (chart_type) query.chart_type = chart_type;
    if (category) query.category = category;
    if (tag) query.tags = tag;

    // Date filters
    if (year || month) {
      query.published_at = {};
      if (year) {
        const startDate = new Date(`${year}-01-01`);
        const endDate = new Date(`${parseInt(year) + 1}-01-01`);
        query.published_at.$gte = startDate;
        query.published_at.$lt = endDate;
      }
      if (month && year) {
        const startDate = new Date(`${year}-${month.padStart(2, '0')}-01`);
        const nextMonth = parseInt(month) + 1;
        const endDate = new Date(
          `${year}-${nextMonth.toString().padStart(2, '0')}-01`
        );
        query.published_at.$gte = startDate;
        query.published_at.$lt = endDate;
      }
    }

    // Search
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;

    const charts = await Chart.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-chart_data'); // Exclude large data by default

    const total = await Chart.countDocuments(query);

    res.status(200).json({
      success: true,
      data: charts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing charts:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getChartConfig = async (req, res) => {
  try {
    const chart = await Chart.findOne({
      $or: [{ _id: req.params.id }, { slug: req.params.id }],
    }).select('chart_type chart_config display_config data_schema');

    if (!chart) {
      return res.status(404).json({
        success: false,
        error: 'Chart not found',
      });
    }

    res.status(200).json({
      success: true,
      data: chart.getChartConfig(),
    });
  } catch (error) {
    console.error('Error getting chart config:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getChartData = async (req, res) => {
  try {
    const chart = await Chart.findOne({
      $or: [{ _id: req.params.id }, { slug: req.params.id }],
    }).select('chart_data data_schema title');

    if (!chart) {
      return res.status(404).json({
        success: false,
        error: 'Chart not found',
      });
    }

    res.status(200).json({
      success: true,
      data: chart.chart_data,
      schema: chart.data_schema,
      title: chart.title,
    });
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getChartTypes = async (req, res) => {
  try {
    const chartTypes = Object.values(CHART_TYPES).map((type) => ({
      value: type,
      label: type
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    }));

    res.status(200).json({
      success: true,
      data: chartTypes,
    });
  } catch (error) {
    console.error('Error getting chart types:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getDataTypes = async (req, res) => {
  try {
    const dataTypes = Object.values(DATA_TYPES).map((type) => ({
      value: type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
    }));

    res.status(200).json({
      success: true,
      data: dataTypes,
    });
  } catch (error) {
    console.error('Error getting data types:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.importCSVData = async (req, res) => {
  try {
    // This would integrate with a CSV parsing library like papaparse
    // For now, we'll assume data is already parsed
    const { csvData, schema } = req.body;

    if (!csvData || !Array.isArray(csvData)) {
      return res.status(400).json({
        success: false,
        error: 'CSV data is required and must be an array',
      });
    }

    // Transform CSV data to chart data format
    const chartData = this.transformCSVToChartData(csvData, schema);

    res.status(200).json({
      success: true,
      data: chartData,
      message: 'CSV data imported successfully',
    });
  } catch (error) {
    console.error('Error importing CSV data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Helper Methods
exports.validateChartData = (chartType, chartData, dataSchema) => {
  if (!Array.isArray(chartData) || chartData.length === 0) {
    return false;
  }

  // Basic validation - can be expanded based on chart type
  switch (chartType) {
    case CHART_TYPES.BAR:
    case CHART_TYPES.STACKED_BAR:
      // Should have at least one index column and one measure column
      const hasIndex = dataSchema?.columns?.some((col) => col.is_index);
      const hasMeasure = dataSchema?.columns?.some((col) => col.is_measure);
      return hasIndex && hasMeasure;

    case CHART_TYPES.PIE:
    case CHART_TYPES.DONUT:
      // Should have one index and one measure
      const pieIndex = dataSchema?.columns?.filter(
        (col) => col.is_index
      ).length;
      const pieMeasure = dataSchema?.columns?.filter(
        (col) => col.is_measure
      ).length;
      return pieIndex === 1 && pieMeasure === 1;

    case CHART_TYPES.SCATTER:
      // Should have at least two measures
      const scatterMeasures = dataSchema?.columns?.filter(
        (col) => col.is_measure
      ).length;
      return scatterMeasures >= 2;

    default:
      return true;
  }
};

exports.transformCSVToChartData = (csvData, schema) => {
  // Transform CSV rows to chart data objects
  return csvData.map((row) => {
    const dataPoint = {};

    schema.columns.forEach((column) => {
      const value = row[column.name];

      // Convert value based on data type
      switch (column.data_type) {
        case DATA_TYPES.NUMERIC:
          dataPoint[column.name] = parseFloat(value) || 0;
          break;
        case DATA_TYPES.TEMPORAL:
          dataPoint[column.name] = new Date(value);
          break;
        default:
          dataPoint[column.name] = value;
      }
    });

    return dataPoint;
  });
};
