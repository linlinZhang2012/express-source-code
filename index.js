/**
 *user: raojianbing
 *date: 2018-02-12 15:21
 *description:
 */
var express = require('express')
var app = express()

app.all('/index', function (req, res) {
	res.send('all /index request to homepage');
});

app.get('/index', function (req, res) {
	res.send('GET /index request to homepage');
});

app.get('/api/*', function (req, res) {
	res.send('GET /api/* request to homepage');
});

app.post('/index', function (req, res) {
	res.send('POST 1 /index request to homepage');
});
app.post('/index', function (req, res) {
	res.send('POST 2 /index request to homepage');
});




console.log('===============')
for(var i = 0; i < app._router.stack.length; i++){
	console.log(app._router.stack[i])
}
console.log('===============')

console.log(app._router)