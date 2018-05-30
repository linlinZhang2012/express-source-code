/**
 *user: raojianbing
 *date: 2018-02-12 15:21
 *description:
 */
var express = require('express')
var app = express()
var r2 = express.Router();
r2.get('/', function (req, res, next) { next(); });

app.all('/index', function (req, res) {
	res.send('all /index request to homepage');
});

app.get('/index', function (req, res) {
	res.send('GET /index request to homepage');
});

app.get('/api/*', function (req, res) {
	res.send('GET /api/* request to homepage');
});

app.use('/index', r2);
app.post('/index', function (req, res) {
	res.send('POST 2 /index request to homepage');
});

app.param(function (param, option) {
	console.log('app.param五参数的被调用');
	return function (req, res, next, val) {
		if (val == option) {
			next();
		}
		else {
			res.sendStatus(403);
		}
	}
})
app.param(['id', 'page'], function (req, res, next, value) {
	console.log('app.param');
	next();
})


app.get('/test/:id', function (req, res) {
	console.log('get param')
	res.send('get param');
})


console.log('===============')

console.log(app._router.params)
console.log(app._router._params)

for(var i = 0; i < app._router.stack.length; i++){
	// console.log(app._router.stack[i])
	if (i === 5) {
		// console.log('这里')
		// console.log(app._router.stack[i].handle.toString())
	}
}
console.log('===============')

console.log(app._router.route.toString())

app.listen(9090)
