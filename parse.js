
var PARSERS = require('./parsers');

var RE_COMMENT_START = /^\s*\/\*\*\s*$/m;
var RE_COMMENT_LINE  = /^\s*\*(?:\s(\s*)|$)/m;
var RE_COMMENT_END   = /^\s*\*\/\s*$/m;
var RE_COMMENT_1LINE = /^\s*\/\*\*\s*(.*)\s*\*\/\s*$/;

/* ------- util functions ------- */

function merge(/* ...objects */) {
  var k, obj, res = {}, objs = Array.prototype.slice.call(arguments);
  while (objs.length) {
    obj = objs.shift();
    for (k in obj) { if (obj.hasOwnProperty(k)) {
      res[k] = obj[k];
    }}
  }
  return res;
}

function find(list, filter) {
  var k, i = list.length, matchs = true;
  while (i--) {
    for (k in filter) { if (filter.hasOwnProperty(k)) {
        matchs = (filter[k] === list[i][k]) && matchs;
    }}
    if (matchs) { return list[i]; }
  }
  return null;
}

/* ------- parsing ------- */

/**
 * Parses "@tag {type} name description"
 * @param {string} str Raw doc string
 * @param {Array[function]} parsers Array of parsers to be applied to the source
 * @returns {object} parsed tag node
 */
function parse_tag(str, parsers) {
  if (typeof str !== 'string' || str[0] !== '@') { return null; }

  var data = parsers.reduce(function(state, parser) {
    var result;

    try {
      result = parser(state.source, merge({}, state.data));
    } catch (err) {
      state.data.errors = (state.data.errors || [])
        .concat(parser.name + ': ' + err.message);
    }

    if (result) {
      state.source = state.source.slice(result.source.length);
      state.data   = merge(state.data, result.data);
    }

    return state;
  }, {
    source : str,
    data   : {}
  }).data;

  data.optional    = !!data.optional;
  data.type        = data.type === undefined        ? '' : data.type;
  data.name        = data.name === undefined        ? '' : data.name;
  data.description = data.description === undefined ? '' : data.description;

  return data;
}

/**
 * Parses comment block (array of String lines)
 */
function parse_block(source, opts) {

  function trim(s) {
    return opts.trim ? s.trim() : s;
  }

  var source_str = source
      .map(function(line) { return trim(line.source); })
      .join('\n');

  source_str = trim(source_str);

  var start = source[0].number;

  // merge source lines into tags
  // we assume tag starts with "@"
  source = source
    .reduce(function(tags, line) {
      line.source = trim(line.source);

      if (line.source.match(/^\s*@(\w+)/)) { 
        tags.push({source: [line.source], line: line.number});
      } else {
        var tag = tags[tags.length - 1];
        tag.source.push(line.source);
      }

      return tags;
    }, [{source: []}])
    .map(function(tag) {
      tag.source = trim(tag.source.join('\n'));
      return tag;
    });

  // Block description
  var description = source.shift();

  // skip if no descriptions and no tags
  if (description.source === '' && source.length === 0) { 
    return null; 
  }

  var tags = source.reduce(function(tags, tag) {
    var tag_node = parse_tag(tag.source, opts.parsers);

    if (!tag_node) { return tags; }

    tag_node.line   = tag.line;
    tag_node.source = tag.source;

    if (opts.dotted_names && tag_node.name.indexOf('.') !== -1) {
      var parent_name;
      var parent_tag;
      var parent_tags = tags;
      var parts = tag_node.name.split('.');

      while (parts.length > 1) {
        parent_name = parts.shift();
        parent_tag  = find(parent_tags, {
          tag  : tag_node.tag,
          name : parent_name
        });

        if (!parent_tag) {
          parent_tag = {
            tag         : tag_node.tag,
            line        : Number(tag_node.line),
            name        : parent_name,
            type        : '',
            description : ''
          };
          parent_tags.push(parent_tag);
        }

        parent_tag.tags = parent_tag.tags || [];
        parent_tags = parent_tag.tags;
      }

      tag_node.name = parts[0];
      parent_tags.push(tag_node);
      return tags;
    }

    return tags.concat(tag_node);
  }, []);
  
  return {
    tags        : tags,
    line        : start,
    description : description.source,
    source      : source_str
  };
}

/**
 * Produces `extract` function with internal state initialized
 */
function mkextract(opts) {
  var chunk = null;
  var number = 0;

  opts = merge({}, {
    trim         : true,
    dotted_names : false,
    parsers      : [
      PARSERS.parse_tag,
      PARSERS.parse_type,
      PARSERS.parse_name,
      PARSERS.parse_description
    ]
  }, opts || {});

  /**
   * Cumulatively reading lines until they make one comment block
   * Returns block object or null.
   */
  return function extract(line) {

    // if oneliner
    // then parse it immediately
    if (line.match(RE_COMMENT_1LINE)) {
      return parse_block([{
        source: line.replace(RE_COMMENT_1LINE, '$1'), 
        number: number}], opts);
    }

    number += 1;

    // if start of comment
    // then init the chunk
    if (line.match(RE_COMMENT_START)) {
      chunk = [{source: line.replace(RE_COMMENT_START, ''), number: number - 1}];
      return null;
    }

    // if comment line and chunk started
    // then append
    if (chunk && line.match(RE_COMMENT_LINE)) {
      chunk.push({
        number: number - 1,
        source: line.replace(RE_COMMENT_LINE, opts.trim ? '' : '$1')
      });
      return null;
    }

    // if comment end and chunk started
    // then parse the chunk and push
    if (chunk && line.match(RE_COMMENT_END)) {
      chunk.push({source: line.replace(RE_COMMENT_END, ''), number: number - 1});
      return parse_block(chunk, opts);
    }

    // if non-comment line
    // then reset the chunk
    chunk = null;
  };
}

/* ------- Public API ------- */

module.exports = function parse(source, opts) {
  var block;
  var blocks  = [];
  var extract = mkextract(opts);
  var lines   = source.split(/\n/);

  while (lines.length) {
    block = extract(lines.shift());
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
};

module.exports.PARSERS = PARSERS;
module.exports.mkextract = mkextract;