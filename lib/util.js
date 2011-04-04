// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var fs = require('fs');
var path = require('path');

var BDB = require('bdb');

module.exports = {

  dbError: function(err, code) {
    var e = new Error(err.message ? err.message : err);
    e.name = 'DbError';

    if (err.code) {
      switch (err.code) {
      case -1:
	e.code = 'DynamicLoadFailure';
	break;
      case 22:
	e.code = 'InvalidArgument';
	break;
      case BDB.FLAGS.DB_NOTFOUND:
	e.code = 'NotFound';
	break;
      default:
	e.code = 'BdbError';
	break;
      }
    } else if (code) {
      e.code = code;
    }

    return e;
  },

  getLibName: function() {
    return path.join(require.resolve('db'),
		     '..',
		     '..',
		     'build/default/node_db_native.node');
  },

  ensureDirectory: function(dir) {
    var index;
    var stats;
    var exists = false;

    if (!dir) throw new Error('dir must not be null');

    stats = fs.statSync(dir);
    if (!stats.isDirectory()) {
      throw new Error(dir + ' exists but is not a directory');
    }
  }
};
