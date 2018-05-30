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

var debug = require('debug')('express:view');
var path = require('path');
var fs = require('fs');

/**
 * Module variables.
 * @private
 */

var dirname = path.dirname;
var basename = path.basename;
var extname = path.extname;
var join = path.join;
var resolve = path.resolve;

/**
 * Module exports.
 * @public
 */

module.exports = View;

/**
 * Initialize a new `View` with the given `name`.
 *
 * Options:
 *
 *   - `defaultEngine` the default template engine name
 *   - `engines` template engine require() cache
 *   - `root` root path for view lookup
 *
 * @param {string} name
 * @param {object} options
 * @public
 */
// sendFile调用
function View(name, options) {
  var opts = options || {};

  this.defaultEngine = opts.defaultEngine;
  // name是文件名，可能有后缀可能没有。
  this.ext = extname(name);
  this.name = name;
  // root是个单项或者是数组。来源app设置的静态文件根目录配置。
  this.root = opts.root;
  // 即没有写明文件后缀名，又没有指定默认模板引擎（处理的后缀）。报错。
  if (!this.ext && !this.defaultEngine) {
    throw new Error('No default engine was specified and no extension was provided.');
  }

  var fileName = name;
  // 如果name是没有后缀的，
  if (!this.ext) {
    // get extension from default engine name
    // 默认引擎（如jade）如果没有带.（.jade jade之分），则带上.拼接，当作name的后缀（最后返回如.jade xxxx.jade）。
    this.ext = this.defaultEngine[0] !== '.'
      ? '.' + this.defaultEngine
      : this.defaultEngine;
    // 这下就有了文件名，带后缀的。但这是默认引擎处理的后缀给拼接的。
    fileName += this.ext;
  }
  // 这里也证明了。engines的属性，是带了.后缀的属性名。
  // 如果引擎列表中，没有处理这个后缀的，则加载对应模块。
  if (!opts.engines[this.ext]) {
    // load engine
    var mod = this.ext.substr(1)
    debug('require "%s"', mod)

    // default engine export
    // 在引擎engines列表中，找不到该后缀对饮处理的引擎。则require加载对应引擎模块。并默认其有一个__express方法作为入口。
    var fn = require(mod).__express

    if (typeof fn !== 'function') {
      throw new Error('Module "' + mod + '" does not provide a view engine.')
    }
    // 配置给引擎列表。
    opts.engines[this.ext] = fn
  }

  // store loaded engine
  // view视图实例的engine属性，值是处理自身这种格式的引擎函数。
  this.engine = opts.engines[this.ext];

  // lookup path
  this.path = this.lookup(fileName);
}

/**
 * Lookup view by the given `name`
 *
 * @param {string} name
 * @private
 */

View.prototype.lookup = function lookup(name) {
  var path;
  // root是单项或者是个数组。视图根目录数组。
  var roots = [].concat(this.root);

  debug('lookup "%s"', name);
  // 在views视图根目录列表中找对应文件，如果有则返回第一个找到文件的根目录path。
  for (var i = 0; i < roots.length && !path; i++) {
    var root = roots[i];

    // resolve the path
    var loc = resolve(root, name);
    var dir = dirname(loc);
    var file = basename(loc);

    // resolve the file
    // 返回文件路径，文件不存在则返回undefined。
    path = this.resolve(dir, file);
  }

  return path;
};

/**
 * Render with the given options.
 *
 * @param {object} options
 * @param {function} callback
 * @private
 */

View.prototype.render = function render(options, callback) {
  debug('render "%s"', this.path);
  // 这个属性，是处理该后缀对应的引擎函数。
  this.engine(this.path, options, callback);
};

/**
 * Resolve the file within the given directory.
 *
 * @param {string} dir
 * @param {string} file
 * @private
 */

View.prototype.resolve = function resolve(dir, file) {
  var ext = this.ext;

  // <path>.<ext>
  var path = join(dir, file);
  var stat = tryStat(path);

  if (stat && stat.isFile()) {
    return path;
  }

  // <path>/index.<ext>
  path = join(dir, basename(file, ext), 'index' + ext);
  // 文件是否存在。
  stat = tryStat(path);

  if (stat && stat.isFile()) {
    return path;
  }
};

/**
 * Return a stat, maybe.
 *
 * @param {string} path
 * @return {fs.Stats}
 * @private
 */

function tryStat(path) {
  debug('stat "%s"', path);

  try {
    return fs.statSync(path);
  } catch (e) {
    return undefined;
  }
}
