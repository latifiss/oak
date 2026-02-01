const router = require('express').Router();
const upload = require('../../middleware/upload');
const uploadController = require('../../controllers/shared/upload.controller');

router.post('/image', upload.single('image'), uploadController.uploadImage);
module.exports = router;
