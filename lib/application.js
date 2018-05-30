/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var finalhandler = require('finalhandler');
var Router = require('./router');
var methods = require('methods');
var middleware = require('./middleware/init');
var query = require('./middleware/query');
var debug = require('debug')('express:application');
var View = require('./view');
var http = require('http');
var compileETag = require('./utils').compileETag;
var compileQueryParser = require('./utils').compileQueryParser;
var compileTrust = require('./utils').compileTrust;
var deprecate = require('depd')('express');
var flatten = require('array-flatten');
var merge = require('utils-merge');
var resolve = require('path').resolve;
var setPrototypeOf = require('setprototypeof')
var slice = Array.prototype.slice;

/**
 * Application prototype.
 */

var app = exports = module.exports = {};

/**
 * Variable for trust proxy inheritance back-compat
 * @private
 */

var trustProxyDefaultSymbol = '@@symbol:trust_proxy_default';

/**
 * Initialize the server.
 *
 *   - setup default configuration
 *   - setup default middleware
 *   - setup route reflection methods
 *
 * @private
 */

// 初始化应用的 cache, engines, settings属性。再继续调用默认配置函数。
app.init = function init() {
  // 缓存。比如视图缓存。属性是render的第一个参数。值是对应的view视图实例。
  this.cache = {};
  // 记录引擎的，可以有多个引擎。key是文件格式后缀，可带点或者不带。value是处理函数。
  this.engines = {};
  // set，enable操作挂载口。
  this.settings = {};

  this.defaultConfiguration();
};

/**
 * Initialize application configuration.
 * @private
 */
// 设定一些默认配置。
app.defaultConfiguration = function defaultConfiguration() {
  var env = process.env.NODE_ENV || 'development';

  // default settings
  // 默认开启epress头部标示。
  this.enable('x-powered-by');
  // etag缓存。
  this.set('etag', 'weak');
  // 环境。
  this.set('env', env);
  // node自带url解析模块还是第三方qs解析模块。这里默认qs。
  this.set('query parser', 'extended');
  this.set('subdomain offset', 2);
  // 是否开设代理校验，默认不开，开启后需要给ip白名单。
  this.set('trust proxy', false);

  // trust proxy inherit back-compat
  Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
    configurable: true,
    value: true
  });

  debug('booting in %s mode', env);

  this.on('mount', function onmount(parent) {
    // inherit trust proxy
    if (this.settings[trustProxyDefaultSymbol] === true
      && typeof parent.settings['trust proxy fn'] === 'function') {
        // 挂载中间件的时候，如果挂载上来的是一个实例，则去掉他的代理设置。看app.use方法，每挂载一次触发mount一次。
      delete this.settings['trust proxy'];
      delete this.settings['trust proxy fn'];
    }

    // inherit protos
    setPrototypeOf(this.request, parent.request)
    setPrototypeOf(this.response, parent.response)
    setPrototypeOf(this.engines, parent.engines)
    setPrototypeOf(this.settings, parent.settings)
  });

  // setup locals
  this.locals = Object.create(null);

  // top-most app is mounted at /
  this.mountpath = '/';

  // default locals
  this.locals.settings = this.settings;

  // default configuration
  // View是一个函数，一个构造函数。实例是一个模板或者说文件。一个path一个实例。
  this.set('view', View);
  // 视图views所在目录。
  this.set('views', resolve('views'));
  // jsonp约定的关键词。默认callback。
  this.set('jsonp callback name', 'callback');

  if (env === 'production') {
    // pro环境开启视图缓存
    this.enable('view cache');
  }

  Object.defineProperty(this, 'router', {
    get: function() {
      throw new Error('\'app.router\' is deprecated!\nPlease see the 3.x to 4.x migration guide for details on how to update your app.');
    }
  });
};

/**
 * lazily adds the base router if it has not yet been added.
 *
 * We cannot add the base router in the defaultConfiguration because
 * it reads app settings which might be set after that has run.
 *
 * @private
 */
// 初始化，创建应用的 _router 属性。由 Router 函数（模块） new 出。
app.lazyrouter = function lazyrouter() {
  // 一个app仅有一个_router属性。
  if (!this._router) {
    this._router = new Router({
      caseSensitive: this.enabled('case sensitive routing'),
      strict: this.enabled('strict routing')
    });
    // express自带的第一个中间件，解析url的中间件。
    this._router.use(query(this.get('query parser fn')));
    // express自带的第二个中间件。往res头部标识增加express标记。app._router.stack 的前2个是这里引入的。
    this._router.use(middleware.init(this));
  }
};

/**
 * Dispatch a req, res pair into the application. Starts pipeline processing.
 *
 * If no callback is provided, then default error handlers will respond
 * in the event of an error bubbling through the stack.
 *
 * @private
 */
// http请求，经历的第二个函数。直接从app函数中透传而来的参数。
app.handle = function handle(req, res, callback) {
  // 应用的 _router 属性，由app.use app.get等动作产生。
  var router = this._router;

  // final handler
  var done = callback || finalhandler(req, res, {
    env: this.get('env'),
    onerror: logerror.bind(this)
  });

  // no routes
  if (!router) {
    debug('no routes defined on app');
    done();
    return;
  }
  
  // 继续透传，http请求即将经历的第三个函数。路由的handle入口函数。参数透传。
  router.handle(req, res, done);
};

/**
 * Proxy `Router#use()` to add middleware to the app router.
 * See Router#use() documentation for details.
 *
 * If the _fn_ parameter is an express app, then it will be
 * mounted at the _route_ specified.
 *
 * @public
 */
// app.use方法。可接收不同格式参数。调用自身 _router对象的use方法。
app.use = function use(fn) {
  var offset = 0;
  var path = '/';

  // default path to '/'
  // disambiguate app.use([fn]) 第一位参数不是函数还有app.use('/xx',fn)
  if (typeof fn !== 'function') {
    var arg = fn;
    // 第一位参数不是函数，就检查是不是 app.use([fn])
    while (Array.isArray(arg) && arg.length !== 0) {
      // 只取出第一位。
      arg = arg[0];
    }

    // first arg is the path.经历以上，排查第一个是不是path。app.use('/xx', fn)  app.use(['/xx'], fn)
    if (typeof arg !== 'function') {
      offset = 1;
      path = fn;
    }
  }
  // 数组拍扁。舍去前面的path。留下fn。
  var fns = flatten(slice.call(arguments, offset));

  if (fns.length === 0) {
    throw new TypeError('app.use() requires a middleware function')
  }

  // setup router
  this.lazyrouter();
  var router = this._router;

  fns.forEach(function (fn) {
    // non-express app。若果是一个app，router实例传入进来，其有相应的其他属性，如果是裸露的fn则if判断成功进入直接调用use。
    if (!fn || !fn.handle || !fn.set) {
      // 裸露的fn传入情况。
      return router.use(path, fn);
    }

    debug('.use app under %s', path);
    // 每个实例（router，app）中间件函数，都有个mountpath以标记是给哪个path处理。
    fn.mountpath = path;
    // 该实例自己的爸爸是谁。。。
    fn.parent = this;

    // restore .app property on req and res
    router.use(path, function mounted_app(req, res, next) {
      var orig = req.app;
      // 调用自身实例的handle方法。router和app实例都是调用touter实例的handle方法。
      fn.handle(req, res, function (err) {
        setPrototypeOf(req, orig.request)
        setPrototypeOf(res, orig.response)
        next(err);
      });
    });

    // mounted an app
    fn.emit('mount', this);
  }, this);

  return this;
};

/**
 * Proxy to the app `Router#route()`
 * Returns a new `Route` instance for the _path_.
 *
 * Routes are isolated middleware stacks for specific paths.
 * See the Route api docs for details.
 *
 * @public
 */

app.route = function route(path) {
  this.lazyrouter();
  return this._router.route(path);
};

/**
 * Register the given template engine callback `fn`
 * as `ext`.
 *
 * By default will `require()` the engine based on the
 * file extension. For example if you try to render
 * a "foo.ejs" file Express will invoke the following internally:
 *
 *     app.engine('ejs', require('ejs').__express);
 *
 * For engines that do not provide `.__express` out of the box,
 * or if you wish to "map" a different extension to the template engine
 * you may use this method. For example mapping the EJS template engine to
 * ".html" files:
 *
 *     app.engine('html', require('ejs').renderFile);
 *
 * In this case EJS provides a `.renderFile()` method with
 * the same signature that Express expects: `(path, options, callback)`,
 * though note that it aliases this method as `ejs.__express` internally
 * so if you're using ".ejs" extensions you dont need to do anything.
 *
 * Some template engines do not follow this convention, the
 * [Consolidate.js](https://github.com/tj/consolidate.js)
 * library was created to map all of node's popular template
 * engines to follow this convention, thus allowing them to
 * work seamlessly within Express.
 *
 * @param {String} ext
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */
// 设定模版引擎。第一个参数是文件格式（带. 或者不带）。第二个是处理函数。
app.engine = function engine(ext, fn) {
  if (typeof fn !== 'function') {
    throw new Error('callback function required');
  }

  // get file extension 接受.html 和html格式参数。engines中属性是带.的。
  var extension = ext[0] !== '.'
    ? '.' + ext
    : ext;

  // store engine记录到引擎设置属性engines中。engines中的属性是带了.的，
  this.engines[extension] = fn;

  return this;
};

/**
 * Proxy to `Router#param()` with one added api feature. The _name_ parameter
 * can be an array of names.
 *
 * See the Router#param() docs for more details.
 *
 * @param {String|Array} name
 * @param {Function} fn
 * @return {app} for chaining
 * @public
 */
// app.param('id', fn), app.param(['id', 'name'], fn)
app.param = function param(name, fn) {
  this.lazyrouter();
  // 如果第一个参数是数组，循环一遍调用
  if (Array.isArray(name)) {
    for (var i = 0; i < name.length; i++) {
      this.param(name[i], fn);
    }

    return this;
  }
  // 参数处理完，最后还是调用_touter属性的方法处理
  this._router.param(name, fn);

  return this;
};

/**
 * Assign `setting` to `val`, or return `setting`'s value.
 *
 *    app.set('foo', 'bar');
 *    app.set('foo');
 *    // => "bar"
 *
 * Mounted servers inherit their parent server's settings.
 *
 * @param {String} setting
 * @param {*} [val]
 * @return {Server} for chaining
 * @public
 */

app.set = function set(setting, val) {
  if (arguments.length === 1) {
    // app.get(setting)参数一个，做取值处理。
    return this.settings[setting];
  }

  debug('set "%s" to %o', setting, val);

  // set value
  // 直接赋值，所以多次赋值会覆盖。如静态资源，就要一个配置清楚。
  this.settings[setting] = val;

  // trigger matched settings
  switch (setting) {
    case 'etag':
      this.set('etag fn', compileETag(val));
      break;
    case 'query parser':
      this.set('query parser fn', compileQueryParser(val));
      break;
    case 'trust proxy':
      this.set('trust proxy fn', compileTrust(val));

      // trust proxy inherit back-compat
      Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
        configurable: true,
        value: false
      });

      break;
  }

  return this;
};

/**
 * Return the app's absolute pathname
 * based on the parent(s) that have
 * mounted it.
 *
 * For example if the application was
 * mounted as "/admin", which itself
 * was mounted as "/blog" then the
 * return value would be "/blog/admin".
 *
 * @return {String}
 * @private
 */

app.path = function path() {
  return this.parent
    ? this.parent.path() + this.mountpath
    : '';
};

/**
 * Check if `setting` is enabled (truthy).
 *
 *    app.enabled('foo')
 *    // => false
 *
 *    app.enable('foo')
 *    app.enabled('foo')
 *    // => true
 *
 * @param {String} setting
 * @return {Boolean}
 * @public
 */

app.enabled = function enabled(setting) {
  return Boolean(this.set(setting));
};

/**
 * Check if `setting` is disabled.
 *
 *    app.disabled('foo')
 *    // => true
 *
 *    app.enable('foo')
 *    app.disabled('foo')
 *    // => false
 *
 * @param {String} setting
 * @return {Boolean}
 * @public
 */

app.disabled = function disabled(setting) {
  return !this.set(setting);
};

/**
 * Enable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @public
 */

app.enable = function enable(setting) {
  return this.set(setting, true);
};

/**
 * Disable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @public
 */

app.disable = function disable(setting) {
  return this.set(setting, false);
};

/**
 * Delegate `.VERB(...)` calls to `router.VERB(...)`.
 */

methods.forEach(function(method){
  app[method] = function(path){
    // get方法如果只有一个参数，则当作set方法。而set方法参数为一个，又回当作取值。
    if (method === 'get' && arguments.length === 1) {
      // app.get(setting)
      return this.set(path);
    }
    // app的_router属性。
    this.lazyrouter();

    var route = this._router.route(path);
    route[method].apply(route, slice.call(arguments, 1));
    return this;
  };
});

/**
 * Special-cased "all" method, applying the given route `path`,
 * middleware, and callback to _every_ HTTP method.
 *
 * @param {String} path
 * @param {Function} ...
 * @return {app} for chaining
 * @public
 */

app.all = function all(path) {
  this.lazyrouter();

  var route = this._router.route(path);
  var args = slice.call(arguments, 1);

  for (var i = 0; i < methods.length; i++) {
    route[methods[i]].apply(route, args);
  }

  return this;
};

// del -> delete alias

app.del = deprecate.function(app.delete, 'app.del: Use app.delete instead');

/**
 * Render the given view `name` name with `options`
 * and a callback accepting an error and the
 * rendered template string.
 *
 * Example:
 *
 *    app.render('email', { name: 'Tobi' }, function(err, html){
 *      // ...
 *    })
 *
 * @param {String} name
 * @param {Object|Function} options or fn
 * @param {Function} callback
 * @public
 */
// 渲染一个模板文件，res调用app的render方法。
app.render = function render(name, options, callback) {
  var cache = this.cache;
  var done = callback;
  var engines = this.engines;
  var opts = options;
  var renderOptions = {};
  var view;

  // support callback function as second arg。
  // 常见技巧之转换可选参数。
  if (typeof options === 'function') {
    done = options;
    opts = {};
  }

  // merge app.locals。浅拷贝属性。把第二个的属性拷贝给第一个
  merge(renderOptions, this.locals);

  // merge options._locals
  if (opts._locals) {
    merge(renderOptions, opts._locals);
  }

  // merge options
  merge(renderOptions, opts);

  // set .cache unless explicitly provided
  if (renderOptions.cache == null) {
    renderOptions.cache = this.enabled('view cache');
  }

  // primed cache
  // 如果开启了视图缓存，则取缓存，但第一次是没有的。
  if (renderOptions.cache) {
    view = cache[name];
  }

  // view没有缓存时---
  if (!view) {
    // 取出视图构造函数。
    var View = this.get('view');
    // 初始化一个视图实例。该实例有“默认引擎，视图根目录，其他引擎”
    view = new View(name, {
      // 默认引擎
      defaultEngine: this.get('view engine'),
      // 视图根目录。可能是单项或者列表。注意设置app的静态资源根目录，需要一次设置，因为赋值是覆盖的不是append。
      root: this.get('views'),
      // 扩展的其他引擎
      engines: engines
    });
    // 这个文件没有。view视图实例没有path。报错。
    if (!view.path) {
      var dirs = Array.isArray(view.root) && view.root.length > 1
        ? 'directories "' + view.root.slice(0, -1).join('", "') + '" or "' + view.root[view.root.length - 1] + '"'
        : 'directory "' + view.root + '"'
      var err = new Error('Failed to lookup view "' + name + '" in views ' + dirs);
      err.view = view;
      return done(err);
    }

    // prime the cache
    // 如果开启了视图换粗，则缓存下来。
    if (renderOptions.cache) {
      cache[name] = view;
    }
  }

  // render
  // 调用view实例的render方法，其还是调用对应文件后缀对应的引擎处理方法。
  tryRender(view, renderOptions, done);
};

/**
 * Listen for connections.
 *
 * A node `http.Server` is returned, with this
 * application (which is a `Function`) as its
 * callback. If you wish to create both an HTTP
 * and HTTPS server you may do so with the "http"
 * and "https" modules as shown here:
 *
 *    var http = require('http')
 *      , https = require('https')
 *      , express = require('express')
 *      , app = express();
 *
 *    http.createServer(app).listen(80);
 *    https.createServer({ ... }, app).listen(443);
 *
 * @return {http.Server}
 * @public
 */

// http请求入口，所有请求都将最先经过express中的app函数。
app.listen = function listen() {
  var server = http.createServer(this);
  return server.listen.apply(server, arguments);
};

/**
 * Log error using console.error.
 *
 * @param {Error} err
 * @private
 */

function logerror(err) {
  /* istanbul ignore next */
  if (this.get('env') !== 'test') console.error(err.stack || err.toString());
}

/**
 * Try rendering a view.
 * @private
 */

function tryRender(view, options, callback) {
  try {
    // view实例有个engine属性，该属性是个函数。就是用来处理自身这个实例的。
    view.render(options, callback);
  } catch (err) {
    callback(err);
  }
}