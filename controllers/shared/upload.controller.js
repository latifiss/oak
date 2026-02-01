const { uploadToR2 } = require('../../utils/r2');

exports.uploadImage = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        status: 'fail',
        message: 'No file uploaded',
      });
    }

    const imageUrl = await uploadToR2(
      file.buffer,
      file.mimetype,
      'editor-uploads'
    );

    res.json({
      status: 'success',
      url: imageUrl,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};
