// CommonJS wrapper around the compiled .node addon.
'use strict';
const path = require('path');
const addon = require(path.join(__dirname, 'build', 'Release', 'window_bounds_native.node'));
module.exports = addon;
