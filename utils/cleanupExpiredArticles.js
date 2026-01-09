const cron = require('node-cron');
const { Article } = require('../models/article.model');

cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running cleanup job for expired top stories...');
    const expiredCount = await Article.updateExpiredTopstories();

    if (expiredCount > 0) {
      console.log(`Cleaned up ${expiredCount} expired top stories`);
    }
  } catch (error) {
    console.error('Error in cleanup job:', error);
  }
});

module.exports = cron;
