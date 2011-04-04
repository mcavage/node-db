#!/usr/bin/env python

import os, subprocess, sys
import Options, Utils
from os import unlink, symlink, chdir, popen, system
from os.path import exists, join

VERSION = '0.1'
REVISION = popen("git log | head -n1 | awk '{printf \"%s\", $2}'").readline()

cwd = os.getcwd()
jsonc_root = cwd + '/deps/json-c-0.9'
srcdir = '.'
blddir = 'build'
sys.path.append(cwd + '/tools')

def set_options(opt):
  opt.tool_options("compiler_cxx")
  opt.tool_options("compiler_cc")
  opt.tool_options('misc')
  opt.add_option('--debug',
                 action='store',
                 default=False,
                 help='Enable debug variant [Default: False]',
                 dest='debug')

def configure(conf):
  conf.check_tool('compiler_cxx')
  if not conf.env.CXX: conf.fatal('c++ compiler not found')
  conf.check_tool("compiler_cc")
  if not conf.env.CC: conf.fatal('c compiler not found')
  conf.check_tool('node_addon')

  o = Options.options

  os.chdir(jsonc_root)
  args = ['./configure', '--disable-shared', '--enable-static', '--with-pic', '--with-gnu-ld']

  subprocess.check_call(args)
  conf.env.append_value('CPPPATH', jsonc_root)
  conf.env.append_value('LIBPATH', jsonc_root)
  os.chdir(cwd)

  conf.env['USE_DEBUG'] = o.debug

  conf.env.append_value('CXXFLAGS', ['-D_FILE_OFFSET_BITS=64',
                                     '-D_LARGEFILE_SOURCE',
                                     '-Wall',
                                     '-fPIC',
                                     '-Werror'])
  if o.debug:
    conf.env.append_value('CXXFLAGS', ["-g"])
  else:
    conf.env.append_value('CXXFLAGS', ['-O3'])

def lint(ctx):
  dirname = cwd + '/src'
  for f in os.listdir(dirname):
    subprocess.check_call(['./dev/cpplint.py',
                           '--filter=-build/include,-build/header_guard,-runtime/rtti',
                           os.path.join(dirname, f)])

  dirname = cwd + '/lib'
  for f in os.listdir(dirname):
    print 'jshint: ' + f
    subprocess.call(['jshint', os.path.join(dirname, f)])

  dirname = cwd + '/test'
  for f in os.listdir(dirname):
    print 'jshint: ' + f
    subprocess.call(['jshint', os.path.join(dirname, f)])

def build(bld):
  obj = bld.new_task_gen('cxx', 'shlib', 'node_addon')
  os.chdir(jsonc_root)
  subprocess.check_call(['make', '-j', '3'])
  subprocess.check_call(['ar', 'rcus', 'libjsonc.a',
                         'arraylist.o',
                         'debug.o',
                         'json_object.o',
                         'json_tokener.o',
                         'json_util.o',
                         'linkhash.o',
                         'printbuf.o'])
  os.chdir(cwd)
  obj.staticlib = "jsonc"

  obj.target = 'node_db_native'
  obj.source = './src/db_index.cc '
  obj.name = "node-db"
  obj.defines = ['NODE_DB_REVISION="' + REVISION + '"']


def test(ctx):
  system('node test/test_basic.js')
  system('node test/test_fixtures.js')

def distclean(ctx):
  os.chdir(jsonc_root)
  os.popen('make distclean 2>&1 > /dev/null')
  os.chdir(cwd)
  os.popen('rm -rf .lock-wscript build')
