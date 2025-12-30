const router=require('express').Router();
const { authenticate } = require('../../middleware/auth');
const {getProducts}=require('./controller');

router.get('/',authenticate,getProducts);

module.exports=router;