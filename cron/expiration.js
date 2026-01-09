const cron = require('node-cron');
const Section = require('../models/ghanapolitan/section.model');

cron.schedule('0 * * * *', async () => {
  console.log('Checking for expired sections...');

  try {
    const result = await Section.updateExpiredSections();

    if (result.modifiedCount > 0) {
      console.log(`Deactivated ${result.modifiedCount} expired sections`);
    }
  } catch (error) {
    console.error('Error updating expired sections:', error);
  }
});

console.log('Expiration cron job scheduled to run every hour');
