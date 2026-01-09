const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const uploadToR2 = async (fileBuffer, mimeType, folder) => {
  if (!process.env.R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  const key = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const uploadParams = {
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  };

  try {
    await s3Client.send(new PutObjectCommand(uploadParams));
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  } catch (error) {
    console.error('R2 Upload Error:', error);
    throw new Error('Failed to upload file to R2 storage');
  }
};

const deleteFromR2 = async (fileUrl) => {
  if (!process.env.R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  const key = fileUrl.replace(`${process.env.R2_PUBLIC_URL}/`, '');
  const deleteParams = {
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(deleteParams));
  } catch (error) {
    console.error('R2 Delete Error:', error);
    throw new Error('Failed to delete file from R2 storage');
  }
};

module.exports = { uploadToR2, deleteFromR2 };
