require('express-async-errors');
const { connectDB } = require('./db/index');
const express = require('express');
require('dotenv').config();
const morgan = require('morgan');
const cors = require('cors');

const ghanapolitanArticleRouter = require('./routes/ghanapolitan/article.routes');
const ghanapolitanFeatureRouter = require('./routes/ghanapolitan/feature.routes');
const ghanapolitanOpinionRouter = require('./routes/ghanapolitan/opinion.routes');
const ghanapolitanChartRouter = require('./routes/ghanapolitan/chart.routes');
const ghanapolitanSectionRouter = require('./routes/ghanapolitan/section.routes');

const ghanascoreArticleRouter = require('./routes/ghanascore/article.routes');
const ghanascoreFeatureRouter = require('./routes/ghanascore/feature.routes');

const afrobeatsrepArticleRouter = require('./routes/afrobeatsrep/article.routes');
const afrobeatsrepFeatureRouter = require('./routes/afrobeatsrep/feature.routes');

const adminRouter = require('./routes/shared/admin.routes');

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
];

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

connectDB();

app.use('/api/ghanapolitan/article', ghanapolitanArticleRouter);
app.use('/api/ghanapolitan/feature', ghanapolitanFeatureRouter);
app.use('/api/ghanapolitan/opinion', ghanapolitanOpinionRouter);
app.use('/api/ghanapolitan/charts', ghanapolitanChartRouter);
app.use('/api/ghanapolitan/sections', ghanapolitanSectionRouter);

app.use('/api/ghanascore/article', ghanascoreArticleRouter);
app.use('/api/ghanascore/feature', ghanascoreFeatureRouter);

app.use('/api/afrobeatsrep/article', afrobeatsrepArticleRouter);
app.use('/api/afrobeatsrep/feature', afrobeatsrepFeatureRouter);

app.use('/api/admin', adminRouter);

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.clear();
  console.log('port is listening on ' + PORT);
});
