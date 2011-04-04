node-db aims to provide node.js with an easy way to build performant, durable
indexed storage. This library provides node with a schema-free,
document-oriented database that is embedded into your node process.  The
library is written on top of Berkeley Database (BDB) 5.1, and is optimized for
key/value use cases.  If you want relational queries, look elsewhere.  If you
want performant put/get/del where your attribute space is controlled, look here.

## Usage

In order to use this, you first need to create a database.  There are a set of
tools bundled with node-db:

* ndb-create: Creates a database (give it a directory on the file system).
* ndb-delete: Destroys a database (pass the same directory you gave ndb-create).
* ndb-index: Creates a new index on the database.
* ndb-load: Give it a file containing an array of JSON objects.  They go in your
  database.

    var Db = require('db');

When creating a database, you give it a hash of options.  The only required
option is 'location', which must be the path to a database you created with
`ndb-create`.  You can optionally pass in `durable` as `false`, which
effectively makes BDB not call sync() on writes.  So your updates
asynchronously flush to disk; increased performance, less durability.
Additionally, if you passed in the `-e` flag (encrypt) to `ndb-create`, you'll
have to provide it here as well (takes a string for the passphrase).  After
that, just call `openSync`.  There is no async version of open, because BDB
gets really bitchy if you let more than one thread into it at open time.  So
just do it up front before your app gets going, and stop worrying about it.
    var options = {
      location: '/var/run/myapp/db',
      encrypt: 's3cr3tP&ssW0rd`,
      durable: true
    };
    var db = new Db(options);
    db.openSync();

To put new objects into the database, you use the `add` method.  The `add`
method will add a few special fields into your object, notably the following
fields:
* _id: a uuid identifier for your object.
* _ctime: creation time
* _mtime: modification time (init'd to _ctime)
* _version: used for updates (since there are no exposed transactions, this
  keeps you from running into nasty consistency errors).

If you try to over-ride those fields, I don't really know what happens.  It
probably works, but don't do that.  If your object has any attributes that match
a created index, they are automatically indexed at insertion time.
    var obj = {
      name: 'Mark',
      key: 'ssh-rsa ...',
      city: Seattle
    };
    db.add(obj, function(err) {
      if (err) {
        // Check err.code
      }
    });
If you don't like the name `add`, try `insert` or `ins`.

You can get retrieve an object if you know the _id that was generated for it:
    db.get(obj._id, function(err, object) {
      if (err) ...
      console.log(require('util').inspect(object));
    });
If you don't like the name `get`...tough.


Similarly, one can update an object with:
    obj.email = 'foo@bar.com'l
    db.update(obj, function(err) {
      if (err) ...
    });
If you don't like `update`, try `modify` or `mod`.


And of course you can delete with:
    db.del(obj, function(err) {
      if (err) ...
    });
If you don't like `del`, try `remove` or `destroy`.

`find`.  Find lets you retrieve a set of records that match an attribute
(you _must_ have made an index already).  Joins aren't supported (yet)
nor are regex matches (also, yet).  But exact matches are most common in
real-world applications anyway, so this works there:
    db.find(filter, options, callback);

Filter, for now, takes one key that is the name of the attribute on your entries
and a value that you want to match against.  Options for now only supports the
`limit` attribute (defaults to 50).
    db.find({email: 'foo@bar.com'}, {limit: 10}, function(err, objects) {
      if (err) ...
      for (var i = 0; i < objects.length; i++) {
        console.log(require('util').inspect(objects[i]));
      }
    });
For now there's no way to use `find` with pagination, but that's a short-term
limitation.  And, if you don't like `find`, try `search`, `query` or `fetch`.

Lastly, you can iterate over your entries with `list`.  `list` does indeed
support pagination:
    var _list = function(limit, start) {
    db.list({limit: limit, start: start}, function(err, objects) {
      for (var i = 0; i < objects.length; i++) {
        console.log(require('util').inspect(objects[i]));
      }
      if (objects.length == 0 || objects.length < limit) {
        console.log('All done');
        return;
      }
      return _list(limit, objects[objects.length -1]._id);
    });
    _list(20);
If you don't like `list`, try `objects`.

### Example Walkthrough

To get you started, there's an example directory containing a test data file
(200 records) and a small app that sticks a cheezy REST API over the top of the
provided database.  To try this out:
    $ git clone https://github.com/mcavage/node-db.git
    $ cd node-db
    $ gunzip examples/data.json.gz
    $ ndb-create /tmp/demo
    $ ndb-load -d /tmp/demo example/data.json
    $ ndb-index -u -d /tmp/demo email
    $ ndb-index -d /tmp/demo city
    $ node example/app.js /tmp/demo/

At this point, you've got a database loaded up, and indexes created on email and
city, where email is a unique index.  First, take a look at the example data to
get a feel for what it looks like, but then here, let's make some queries.  Your
life will be a lot nicer if you have the `json` command installed for node.
There are a few flying around, I like this one: https://github.com/trentm/json
as it properly handles arrays off stdin.  Anyway, let's get started:
    $ curl -is localhost:3000/?city=Chico | json
    $ curl -is localhost:3000/C296BEB4-1A34-4A43-A31D-AFC68A56F213 | json
    $ curl -is localhost:3000/C296BEB4-1A34-4A43-A31D-AFC68A56F213 | json > /tmp/update.json

Go ahead and change a value or two in /tmp/update.json, and then:
    $ curl -is -X PUT localhost:3000/C296BEB4-1A34-4A43-A31D-AFC68A56F213 -d @/tmp/update.json
    $ curl -is -X DELETE localhost:3000/47EAA778-13AF-449C-85DC-438835A286EB
    $ curl -is localhost:3000/?city=Chico | json
    $ curl -is -X POST localhost:3000/?city=Seattle\&first_name=Mark\&email=foo@bar.com
    $ curl -is localhost:3000/?city=Seattle | json

Go ahead back and kill the node daemon, then cleanup:
    $ ndb-delete /tmp/demo

Take a look at example/app.js to get a feel for what all just happened.

## Installation

    npm install db

(You can also install it by doing `node-waf configure build` and then
linking or copying the folder into your project's `node_modules`
directory.)

Note that node-bdb will also build a static version of BDB, and *will
place BDB utilities in your $NODE_PATH/bin*.  So, if you've already got a BDB
on your system in that path (like, oh say /usr/bin), this is going to end badly
for you. If you've got a version of BDB on your system, there are
--shared-bdb-[include/libpath] options you can pass in at configure time.  That
will skip the static library compilation, and *not* lay down any of the BDB
utilities.

## License

I'm putting this project under MIT, but you *really* need to be aware of
the BDB license.  BDB is put out under a dual-license model: Sleepycat and
commercial.  IANAL, but effectively the sleepycat license has a copy-left clause
in it that makes any linking to BDB require your application to be open sourced
if you redistribute it.  You can opt to license BDB under a commercial license
if those terms don't suit you.

## TODO

* Joins
* _MUCH_ faster bulk uploads.
* Synchronous replication
* Directly embedding BDB, and optimizing this thing (I can probably get a 3-5X
  speedup before profiling for updates and 1.5-2X for gets).
* Use msgpack for storage, instead of dumb JSON.

## Bugs

See <https://github.com/mcavage/node-db/issues>.
