// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var Buffer = require('buffer').Buffer;
var util = require('util');

var BDB = require('bdb');
var uuid = require('node-uuid');

var _util = require('./util');
var dbError = _util.dbError;

var Db = (function() {

  /**
   * Constructor
   * @param {Object} options
   *                 REQUIRED
   *                  - location: Database location on the FS
   *                 OPTIONS
   *                  - durable: indicates whether TXNs should be synchronous,
   *                             defaulted to true (currently ignored)
   *                  - encrypt: {String} pass in a password, and all databases
   *                             will be encrypted with the phrase.
   *                  - errorFile: filename to write BDB error information to
   */
  function Db(options) {
    if (!options || !options.location ||
	typeof options.location !== 'string') {
      throw new TypeError('options.location is required as a string');
    }

    this.dbHome = options.location;
    this.durable = options.durable ? options.durable : true;
    this.encrypt = options.encrypt ? true : false;
    this.env = new BDB.DbEnv();
    this.env.setErrorPrefix('ndb');
    if (options.errorFile) {
      this.env.setErrorFile(options.errorFile);
    }

    if (options.encrypt) {
      if (typeof options.encrypt !== 'string') {
	throw new TypeError('options.encrypt must be a string');
      }
      var res = this.env.setEncrypt(options.encrypt);
      if (res.code !== 0) throw dbError(res);
    }

    if (!this.durable) {
      this.env.setFlags(BDB.FLAGS.DB_TXN_NOSYNC);
    }

    this.indexDbObjects = {};
    this.uniqueIndexDbObjects = {};
    this.open = false;

    // Ensure the DB gets shutdown cleanly
    var self = this;
    process.on('exit', function shutdown() {
      self.closeSync();
    });
  }


  /**
   * Opens the database and runs any necessary recovery.
   *
   * @throws Error if anything goes wrong
   */
  Db.prototype.openSync = function() {
    var attrs;
    var i;
    var res;
    var flags = 0;

    _util.ensureDirectory(this.dbHome);
    res = this.env.openSync({home: this.dbHome});
    if (res.code !== 0) throw dbError(res);

    this.primary = new BDB.Db(this.env);
    this.indices = new BDB.Db(this.env);
    this.uniqueIndices = new BDB.Db(this.env);
    if (this.encrypt) {
      this.primary.setFlags(BDB.FLAGS.DB_ENCRYPT);
    }

    res = this.primary.openSync({file: '__node_db_primary_',
				 type: BDB.FLAGS.DB_BTREE});
    if (res.code !== 0) throw dbError(res);

    res = this.uniqueIndices.openSync({file: '__node_db_unique_index_'});
    if (res.code !== 0) throw dbError(res);

    res = this.indices.openSync({file: '__node_db_index_'});
    if (res.code !== 0) throw dbError(res);

    this.open = true;

    attrs =
      this.uniqueIndices.cursorGetSync({initFlag: BDB.FLAGS.DB_FIRST});
    if (attrs.code !== 0 && attrs.code != BDB.FLAGS.DB_NOTFOUND) {
      throw dbError(res);
    }
    for (i = 0; i < attrs.data.length; i++) {
      this.ensureUniqueIndexSync(
	{
	  attr: attrs.data[i].key.toString(encoding='utf8'),
	  skipInsert: true
	});
    }

    attrs = this.indices.cursorGetSync({initFlag: BDB.FLAGS.DB_FIRST});
    if (attrs.code !== 0 && attrs.code != BDB.FLAGS.DB_NOTFOUND) {
      throw dbError(res);
    }
    for (i = 0; i < attrs.data.length; i++) {
      this.ensureIndexSync(
	{
	  attr: attrs.data[i].key.toString(encoding='utf8'),
	  skipInsert: true
	});
    }

  };


  /**
   * Closes the database
   */
  Db.prototype.closeSync = function() {
    if (!this.open) return;

    var i;
    this.primary.closeSync();
    this.indices.closeSync();
    this.uniqueIndices.closeSync();
    this.indexDbObjects = {};

    for (i in this.indexDbObjects) {
      if(this.indexDbObjects.hasOwnProperty(i)) {
	this.indexDbObjects[i].closeSync();
      }
    }

    for (i in this.uniqueIndexDbObjects) {
      if(this.uniqueIndexDbObjects.hasOwnProperty(i)) {
	this.uniqueIndexDbObjects[i].closeSync();
      }
    }

    this.env.closeSync();
    this.open = false;
  };


  /**
   * Creates a unique index on the database
   *
   *
   * @param {Object} options:
   *           - {String} attr: the attribute on which to index
   *           - {Boolean} create: whether to walk the primary and create index
   *           - {Boolean} skipInsert: (don't use this - internal only)
   */
  Db.prototype.ensureUniqueIndexSync = function(options) {
    if (!this.open) throw Error('Database not open');
    if (!options || (typeof options !== 'object')) {
      throw Error('options must be an Object');
    }
    if (typeof options.attr !== 'string') {
      throw Error('options.attr must be a String');
    }
    if (options.create && typeof options.create !== 'boolean') {
      throw Error('options.create must be a Boolean');
    }

    var _key = new Buffer(options.attr);
    var _val = new Buffer(options.attr);
    var lib;
    var res;
    var secondary;

    // First check if we already have the index
    if (!options.skipInsert) {
      res = this.uniqueIndices.getSync({key: _key});
      if (res.code === 0) return;
    }

    // If not, db associate a new one
    secondary = new BDB.Db(this.env);
    if (this.encrypt) {
      secondary.setFlags(BDB.FLAGS.DB_ENCRYPT);
    }

    res = secondary.openSync({file: options.attr});
    if (res.code !== 0) throw dbError(res);

    lib = _util.getLibName();
    res = this.primary._associateSync(secondary, lib, 'get_index_key',
				      options.create ? BDB.FLAGS.DB_CREATE : 0);
    if (res.code !== 0) throw dbError(res);

    this.uniqueIndexDbObjects[options.attr] = secondary;

    if (!options.skipInsert) {
      res = this.uniqueIndices.putSync({key: _key, val: _val});
      if (res.code !== 0) throw dbError(res);
    }
  };


  /**
   * Creates an index on the database
   *
   *
   * @param {Object} options:
   *           - {String} attr: the attribute on which to index
   *           - {Boolean} create: whether to walk the primary and create index
   *           - {Boolean} skipInsert: (don't use this - internal only)
   */
  Db.prototype.ensureIndexSync = function(options) {
    if (!this.open) throw Error('Database not open');
    if (!options || (typeof options !== 'object')) {
      throw Error('options must be an Object');
    }
    if (typeof options.attr !== 'string') {
      throw Error('options.attr must be a String');
    }
    if (options.create && typeof options.create !== 'boolean') {
      throw Error('options.create must be a Boolean');
    }

    var _key = new Buffer(options.attr);
    var _val = new Buffer(options.attr);
    var lib;
    var res;
    var secondary;
    var flags = BDB.FLAGS.DB_DUP;

    // First check if we already have the index
    if (!options.skipInsert) {
      res = this.indices.getSync({key: _key});
      if (res.code === 0) return;
    }

    // If not, db associate a new one
    secondary = new BDB.Db(this.env);
    if (this.encrypt) {
      flags = flags | BDB.FLAGS.DB_ENCRYPT;
    }
    secondary.setFlags(flags);

    res = secondary.openSync({file: options.attr});
    if (res.code !== 0) throw dbError(res);

    lib = _util.getLibName();
    res = this.primary._associateSync(secondary, lib, 'get_index_key',
				      options.create ? BDB.FLAGS.DB_CREATE : 0);
    if (res.code !== 0) throw dbError(res);

    this.indexDbObjects[options.attr] = secondary;

    if (!options.skipInsert) {
      res = this.indices.putSync({key: _key, val: _val});
      if (res.code !== 0) throw dbError(res);
    }
  };


  /**
   * Inserts a document
   *
   * @param {Object} document: Free form JSON object you want in the DB
   * @param {Function} callback: function with args (err)
   * @throws Error if arguments are invalid
   */
  Db.prototype.add = function(obj, callback) {
    if (!this.open) throw Error('Database not open');
    var _key;
    var _val;
    var err;

    if ((typeof obj) !== 'object')
      throw new TypeError('obj must be an object');
    if (callback === null || (typeof callback) !== 'function') {
      throw new TypeError('callback must a function of type f(err, res)');
    }

    if (obj.hasOwnProperty('_id')) {
      throw new Error('document already has _id property: ' + obj._id);
    }

    obj._id = uuid();
    obj._version = 1;
    obj._ctime = new Date().getTime();
    obj._mtime = obj._ctime;
    _key = new Buffer(obj._id);
    try {
      _val = new Buffer(JSON.stringify(obj));
    } catch (e) {
      return callback(e);
    }

    this.primary.put({key: _key, val: _val}, function(res) {
      if (res.code !== 0) return callback(dbError(res));

      return callback();
    });
  };
  Db.prototype.insert = Db.prototype.add;
  Db.prototype.ins = Db.prototype.add;


  /**
   * Retrieves a document
   *
   * @param {String} key: the _id property of a document object previously put
   * @param {Function} callback: function with args (err, object)
   * @throws Error if arguments are invalid
   */
  Db.prototype.get = function(key, callback) {
    if (!this.open) throw Error('Database not open');
    var _key;
    var err;

    if ((typeof key) !== 'string') throw new TypeError('key must be a string');
    if (callback === null || (typeof callback) !== 'function')
      throw new TypeError('callback must a function of type f(Error, Object)');

    _key = new Buffer(key);
    this.primary.get({key: _key}, function(res, data) {
      if (res.code !== 0) return callback(dbError(res));

      try {
	return callback(undefined, JSON.parse(data.toString(encoding='utf8')));
      } catch (e) {
	return callback(e);
      }
    });
  };


  /**
   * Updates a document
   *
   * This method does a transactional fetch and compare against your object
   * to ensure that nothing changed out from under you.  If it did you'll get
   * a consistency error.
   *
   * This needs to get faster!  We can do better than this if we're not
   * using a general BDB binding, but purpose wrapping...(v2)
   *
   * @param {Object} obj
   * @param {Function} callback
   */
  Db.prototype.update = function(obj, callback) {
    if (!this.open) throw Error('Database not open');
    var _key;
    var _val;
    var err;

    if ((typeof obj) !== 'object')
      throw new TypeError('obj must be an object');
    if (callback === null || (typeof callback) !== 'function') {
      throw new TypeError('callback must a function of type f(err, res)');
    }

    if (!obj.hasOwnProperty('_id')) {
      throw new Error('document missing _id property: Did you need to insert?');
    }

    _key = new Buffer(obj._id);

    var self = this;
    this.primary.get({key: _key}, function(res, data) {
      if (res.code !== 0) return callback(dbError(res));

      try {
	var other = JSON.parse(data.toString(encoding='utf8'));
	if (other._version !== obj._version) {
	  return callback(dbError('Version mismatch: object in DB is now: ' +
				  other._version +
				  ', object that was being saved is: ' +
				  obj._version,
				  'ConsistencyError'));
	}

	obj._version += 1;
	obj._mtime = new Date().getTime();
	_val = new Buffer(JSON.stringify(obj));
	self.primary.putIf({key: _key, val: _val, oldVal: data}, function(res) {
	  if (res.code !== 0) return callback(dbError(res));
	  return callback();
      });
      } catch (e) {
	return callback(e);
      }
    });
  };
  Db.prototype.mod = Db.prototype.update;
  Db.prototype.modify = Db.prototype.update;


  /**
   * Deletes a document
   *
   * @param {String} key: an id
   * @param {Function} callback: function with args (err)
   * @throws Error if arguments are invalid
   */
  Db.prototype.del = function(key, callback) {
    if (!this.open) throw Error('Database not open');
    var _key;
    var err;

    if ((typeof key) !== 'string') throw new TypeError('key must be a string');
    if (callback === null || (typeof callback) !== 'function')
      throw new TypeError('callback must a function of type f(Error)');

    _key = new Buffer(key);
    this.primary.del({key: _key}, function(res) {
      if (res.code !== 0) return callback(dbError(res));

      return callback();
    });
  };
  Db.prototype.remove = Db.prototype.del;
  Db.prototype.destroy = Db.prototype.del;


  /**
   * Retrieves a document by an indexed attribute
   *
   * @param {Object} filter:
   *                  {username: 'mark'}
   *
   * @param {Object} options (optional).  Only attribute currenlty supported
   *                 is 'limit' (default is 50).
   *
   *
   * @param {Function} callback: function with args (err, object)
   * @throws Error if arguments are invalid
   */
  Db.prototype.find = function(filter, options, callback) {
    if (!this.open) throw Error('Database not open');

    if (typeof filter !== 'object') {
      throw new TypeError('options must be an object');
    }
    if (typeof options === 'function') {
      callback = options;
    } else if (typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('callback must a function of type f(Error, Object)');
    }

    var limit = 50;
    if (options.limit) limit = options.limit;

    var db;
    var attrs = [];
    var query;
    var unique = true;

    for (var attr in filter) {
      if (filter.hasOwnProperty(attr)) {
	db = this.uniqueIndexDbObjects[attr];
	if (db) {
	  query = filter[attr];
	  break;
	}

	db = this.indexDbObjects[attr];
	if (db) {
	  query = filter[attr];
	  unique = false;
	  break;
	}

	attrs.push(attr);
      }
    }

    if (!db) {
      return callback(dbError('no indexes found for attributes' +
			      util.inspect(attrs), 'NoIndex'));
    }

    var _key = new Buffer(query);
    var key = {key: _key};
    if (unique) {
      key.limit = 1;
    } else {
      key.limit = limit;
    }
    key.flags = BDB.FLAGS.DB_NEXT_DUP;
    db.cursorGet(key, function(res, records) {
      if (res.code !== 0 && res.code !== BDB.FLAGS.DB_NOTFOUND) {
	return callback(dbError(res));
      }

      try {
	var objects = [];
	for (var i = 0 ; i < records.length; i++) {
	  objects.push(JSON.parse(records[i].value.toString(encoding='utf8')));
	}
	return callback(undefined, objects);
      } catch (e) {
	return callback(e);
      }
    });
  };
  Db.prototype.fetch = Db.prototype.find;
  Db.prototype.query = Db.prototype.find;
  Db.prototype.search = Db.prototype.find;


  /**
   * Returns a set of entries (both k/v).
   *
   * You can either start from the beginning of the DB, and iterate from there,
   * getting arrays up to size limit.  Pass in the last key returned to iterate
   * over the next set of keys (e.g., use it as next token).
   *
   * @param {Object} options (optional).
   *                 - 'limit' (default is 50).
   *                 - 'start' (default empty)
   *
   *
   * @param {Function} callback: function with args (err, object)
   * @throws Error if arguments are invalid
   */
  Db.prototype.list = function(options, callback) {
    if (!this.open) throw Error('Database not open');

    if (typeof options === 'function') {
      callback = options;
    } else if (typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('callback must a function of type f(Error, Object)');
    }

    var start;
    var limit = 50;
    if (options.limit) limit = options.limit;
    if (options.start) start = options.start;


    var key = {
      key: new Buffer((start ? start : 0)),
      limit: (start ? limit + 1 : limit),
      initFlag: (start ? BDB.FLAGS.DB_SET : BDB.FLAGS.DB_FIRST),
      flags: BDB.FLAGS.DB_NEXT,
    };

    this.primary.cursorGet(key, function(res, records) {
      if (res.code !== 0 && res.code !== BDB.FLAGS.DB_NOTFOUND) {
	return callback(dbError(res));
      }

      try {
	var objects = [];
	for (var i = 0; i < records.length; i++) {
	  var skip = false;
	  var o = JSON.parse(records[i].value.toString(encoding='utf8'));
	  if (start) {
	    if (o._id === start) {
	      skip = true;
	    }
	  }
	  if (!skip) {
	    objects.push(o);
	  }
	}

	return callback(undefined, objects);
      } catch (e) {
	return callback(e);
      }
    });
  };
  Db.prototype.objects = Db.prototype.list;


  return Db;

})();

module.exports = Db;
