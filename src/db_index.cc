// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
#include <alloca.h>
#include <stdlib.h>
#include <string.h>

#include <db.h>
#include <json.h>


extern "C"
int get_index_key(DB *dbp, const DBT *key, const DBT *data, DBT *skey) {
  char *buf = NULL;
  char *index = NULL;
  const char *val = NULL;
  int rc = -1;
  int len = 0;
  json_object *obj = NULL;
  json_object *attr = NULL;

  rc = dbp->get_dbname(dbp, (const char **)&index, NULL);
  if (rc != 0) return rc;

  buf = static_cast<char *>(alloca(data->size));
  if (buf == NULL) goto out;

  strncpy(buf, static_cast<char *>(data->data), data->size);
  obj = json_tokener_parse(buf);
  if (obj == NULL) goto out;

  attr = json_object_object_get(obj, index);
  if (attr == NULL) goto out;

  val = json_object_get_string(attr);
  if (val == NULL) goto out;

  len = strlen(val);
  memset(skey, 0, sizeof(DBT));
  skey->data = calloc(1, len);
  if (skey->data == NULL) goto out;

  memcpy(skey->data, val, len);
  skey->size = len;
  skey->flags = DB_DBT_APPMALLOC;
  rc = 0;

 out:
  if (attr != NULL) json_object_put(attr);
  if (obj != NULL) json_object_put(obj);

  return rc;
}

