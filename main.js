const express = require('express');
const rateLimit = require('express-rate-limit')
const cors = require('cors');
const fileUpload = require('express-fileupload');
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 8000;

const {app,server,io,socketIO} = require('./socket.js')

const {whatsappPOSThandler,whatsappGEThandler} = require('./whatsapp-api.js')
const secretKey = '019jd99jsi91jedi0djjwi000jdos00290iujk';

const APIlimiterStd = rateLimit({
  skipFailedRequests: true,
  windowMs:  24*60*60*1000, // 1 day window
  standardHeaders: false, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers,
  max: 3,
  handler: (req, res, next) => {
    res.status(429).send(JSON.stringify({
      status: 'error',
      message: 'Too Many Requests, please try again in 24 Hours later.'})
    );
  }
})
const APIlimiterPremium = rateLimit({
    skipFailedRequests: true,
    windowMs:  7*24*60*60*1000, // 1 week window
    standardHeaders: false, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers,
    max: 50,
    keyGenerator: (req) => jwt.verify(req.headers.authorization.split(' ')[1], secretKey),
    handler: (req, res, next) => {
      res.status(429).send(JSON.stringify({
        status: 'error',
        message: 'Too Many Requests, please try again later.'})
      );
    }
})
const invalidAPIrequest = (req, res) => {
  res.status(404).send(JSON.stringify({
    status: 'error',
    message: 'Invalid API'
  }))
}

app.use(function(req,res,next){
  console.log(req.socket.remoteAddress)
  next()
});

app.use(express.json(),cors());

app.use(express.urlencoded({
extended: true
}));

app.use(fileUpload({
  debug: false
}));
app.use('/uptime', (req, res) => {
  res.send('Server is up and running');
})
app.use('/publicapi', APIlimiterStd)
app.use('/api',async(req, res, next) => {
  res.set('x-powered-by', 'nuriz.id');
  if ( req.path == '/' || req.path=='/ip') return next();
  if(!req.headers['authorization']){
    res.status(401).send(JSON.stringify({
      status: 'error',
      message: 'Missing authorization on request'
    }))
    return;
  }else{
    const token = req.headers['authorization'].split(' ')[1];
    let decoded = null
    try{
     decoded = jwt.verify(token, secretKey);
    }catch(err){
      // console.log(err)
      res.status(401).send(JSON.stringify({
        status: 'error',
        message: 'Invalid authorization on request'
      }))
      return;
    }
  }
  next();
},APIlimiterPremium);

//testing number of proxy
app.set('trust proxy', 2) //ubah angka sampai result di /ip sesuai dengan ip sebenarnya
app.get('/ip', (request, response) => response.send(request.ip))
app.get('/whatsapp', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});
app.get('/', (req, res) => {
  res.send('ok')
});
// Public API
app.get('/publicapi/*',(req,res)=>{
  switch(req.params[0]){
    default:
      invalidAPIrequest(req,res);
      break;
  }
})
app.post('/publicapi/*',(req,res)=>{
  switch(req.params[0]){
    case 'send-message':
      postSendMessage(req,res);
      break
    default:
      invalidAPIrequest(req,res);
      break;
  }
})
// Premium API
app.use('/api/*',(req,res)=>{
  req.params = req.params[0].split('/');
  // console.log(`${req.params[0]}${req.method}handler(req,res)`)
  try{
    eval(`${req.params[0]}${req.method}handler(req,res)`)
  }catch(err){
    invalidAPIrequest(req,res);
  }
})

server.listen(port, function() {
  console.log('App running on *: ' + port);
});

module.exports = {
  secretKey
}