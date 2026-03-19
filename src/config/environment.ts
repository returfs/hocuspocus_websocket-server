import dotenv from 'dotenv';

dotenv.config();

export const config = {
  name: process.env.APP_NAME || 'hocuspocus',
  env: process.env.APP_ENV || 'development',
  port: process.env.APP_PORT || '1234',
  host: process.env.APP_HOST || 'localhost',
  debug: process.env.APP_DEBUG === 'true',
  apiUrl: process.env.RETURFS_API_URL || 'http://project.test',
  apiKey: process.env.RETURFS_API_KEY,
};
