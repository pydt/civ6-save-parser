'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const zlib = require('zlib');

const START_PLAYER = new Buffer([0x58, 0xBA, 0x7F, 0x4C]);
const END_UNCOMPRESSED = new Buffer([0, 0, 1, 0]);
const COMPRESSED_DATA_END = new Buffer([0, 0, 0xFF, 0xFF]);

const GAME_DATA = {
  GAME_TURN: new Buffer([0x9D, 0x2C, 0xE6, 0xBD]),
  GAME_SPEED: new Buffer([0x99, 0xB0, 0xD9, 0x05])
};

const PLAYER_DATA = {
  PLAYER_CIV: new Buffer([0x2F, 0x5C, 0x5E, 0x9D]),
  PLAYER_CIV_TYPE: new Buffer([0xBE, 0xAB, 0x55, 0xCA]),
  PLAYER_PASSWORD: new Buffer([0x6C, 0xD1, 0x7C, 0x6E]),
  PLAYER_NAME: new Buffer([0xFD, 0x6B, 0xB9, 0xDA]),
  PLAYER_CURRENT_TURN: new Buffer([0xCB, 0x21, 0xB0, 0x7A]),
  PLAYER_DESCRIPTION: new Buffer([0x65, 0x19, 0x9B, 0xFF])
};


module.exports.parse = (filename, options) => {
  options = options || {};
  const data = fs.readFileSync(filename);
  const result = {
    PLAYERS: []
  };

  const buffer = new Buffer(data);

  let state;

  while (null !== (state = readState(buffer, state))) {
    if (state.next4.equals(GAME_DATA.GAME_SPEED)) {
      break;
    }
    state.pos++;
  }

  do {
    if (state.next4.equals(END_UNCOMPRESSED)) {
      if (options.outputCompressed) {
        readCompressedData(buffer, state, path.basename(filename) + '.bin');
      }

      break;
    }

    const info = parseEntry(buffer, state);

    for (let key in GAME_DATA) {
      if (info.marker.equals(GAME_DATA[key])) {
        result[key] = info;
      }
    }

    if (info.marker.equals(START_PLAYER)) {
      result.PLAYERS.push({
        pos: state.pos,
        data: readPlayer(info, buffer, state)
      });
    }
  } while (null !== (state = readState(buffer, state)));

  return result;
};

if (!module.parent) {
  var argv = require('minimist')(process.argv.slice(2));
  if (!argv._.length) {
    console.log('Please pass the filename as the argument to the script.');
  } else {
    const result = module.exports.parse(argv._[0], argv);
    if (argv.simple) {
      console.log(util.inspect(simplify(result), false, null));
    } else {
      console.log(util.inspect(result, false, null));
    }
  }
}

// Parse helper functions

function simplify(result) {
  let mapFn = _.mapValues;

  if (_.isArray(result)) {
    mapFn = _.map;
  }

  return mapFn(result, i =>{
    if (i.data && !_.isObject(i.data)) {
      return i.data;
    }

    return simplify(i.data || i);
  });
}

function readState(buffer, state) {
  if (!state) {
    state = {
      pos: 0,
      next4: buffer.slice(0, 4)
    };
  } else {
    if (state.pos >= buffer.length - 4) {
      return null;
    }

    state.next4 = buffer.slice(state.pos, state.pos + 4);
  }

  return state;
}

function parseEntry(buffer, state) {
  const result = {
    pos: state.pos,
    marker: state.next4,
    type: buffer.readUInt32LE(state.pos + 4)
  };

  state.pos += 8;

  if (result.marker.readUInt32LE() < 256) {
    result.data = 'SKIP';
  } else {
    switch (result.type) {
      case 1:
        result.data = readBoolean(buffer, state);
        break;

      case 2:
        result.data = readInt(buffer, state);
        break;

      case 3:
      case 0x0A:
      case 0x15:
        result.data = 'UNKNOWN!';
        state.pos += 12;
        break;

      case 5:
        result.data = readString(buffer, state);
        break;

      case 6:
        result.data = readUtfString(buffer, state);
        break;

      case 0x14:
        result.data = 'UNKNOWN!';
        state.pos += 16;
        break;

      case 0x0B:
        result.data = 'UNKNOWN!';
        state.pos += 28;
        break;

      default:
        throw new Error('Error parsing: ' + JSON.stringify(result));
    }
  }

  return result;
}

function readPlayer(info, buffer, state) {
  const result = {};

  do {
    if (info === null) {
      info = parseEntry(buffer, state);
    }

    for (let key in PLAYER_DATA) {
      if (info.marker.equals(PLAYER_DATA[key])) {
        result[key] = info;
      }
    }

    if (info.marker.equals(PLAYER_DATA.PLAYER_DESCRIPTION)) {
      break;
    }

    info = null;
  } while ((state = readState(buffer, state)) != null);

  return result;
}

function readString(buffer, state) {
  const origState = _.clone(state);
  let result = null;

  const strLen = buffer.readUInt16LE(state.pos);
  state.pos += 2;

  const strInfo = buffer.slice(state.pos, state.pos + 6);
  //new Buffer([0, 0x21, 1, 0, 0, 0]))
  if (strInfo[1] === 0 || strInfo[1] === 0x20) {
    state.pos += 10;
    result = 'Don\'t know what this kind of string is...';
  } else if (strInfo[1] === 0x21) {
    state.pos += 6;
    result = buffer.slice(state.pos, state.pos + strLen - 1).toString(); // Ignore null terminator
    state.pos += strLen;
  }

  if (result === null) {
    throw new Error('Error reading string: ' + JSON.stringify(origState));
  }

  return result;
}

function readUtfString(buffer, state) {
  const origState = _.clone(state);
  let result = null;

  const strLen = buffer.readUInt16LE(state.pos) * 2;
  state.pos += 2;

  if (buffer.slice(state.pos, state.pos + 6).equals(new Buffer([0, 0x21, 2, 0, 0, 0]))) {
    state.pos += 6;
    result = buffer.slice(state.pos, state.pos + strLen - 2).toString('ucs2'); // Ignore null terminator
    state.pos += strLen;
  }

  if (result === null) {
    throw new Error('Error reading string: ' + JSON.stringify(origState));
  }

  return result;
}

function readBoolean(buffer, state) {
  state.pos += 8;
  const result = !!buffer[state.pos];
  state.pos += 4;
  return result;
}

function readInt(buffer, state) {
  state.pos += 8;
  const result = buffer.readUInt32LE(state.pos);
  state.pos += 4;
  return result;
}

function readCompressedData(buffer, state, filename) {
  const compressedData = buffer.slice(state.pos + 4, buffer.indexOf(COMPRESSED_DATA_END, state.pos));
  const uncompressedData = zlib.unzipSync(compressedData);
  fs.writeFileSync(filename, uncompressedData);
}
