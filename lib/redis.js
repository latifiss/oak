import { createClient } from 'redis';

const redisConfig = {
  username: 'default',
  password: 'kJIV0G8RPmZ8FZllTo3Wisz3sVmzWpi2',
  socket: {
    host: 'redis-12880.fcrce213.us-east-1-3.ec2.redns.redis-cloud.com',
    port: 12880,
  },
};

const client = createClient(redisConfig);

client.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

let isConnected = false;

export const getRedisClient = async () => {
  if (!isConnected) {
    console.log('🔌 Connecting to Redis...');
    await client.connect();
    isConnected = true;
    console.log('✅ Connected to Redis!');
  } else {
    console.log('♻️ Reusing existing Redis connection');
  }

  return client;
};
