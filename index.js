'use strict';

require('buffer-v6-polyfill');

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const zlib = require('zlib');

const START_ACTOR = new Buffer([0x58, 0xBA, 0x7F, 0x4C]);
const END_UNCOMPRESSED = new Buffer([0, 0, 1, 0]);
const COMPRESSED_DATA_END = new Buffer([0, 0, 0xFF, 0xFF]);

const GAME_DATA = {
  GAME_TURN: new Buffer([0x9D, 0x2C, 0xE6, 0xBD]),
  GAME_SPEED: new Buffer([0x99, 0xB0, 0xD9, 0x05])
};

const ACTOR_DATA = {
  ACTOR_NAME: new Buffer([0x2F, 0x5C, 0x5E, 0x9D]),
  ACTOR_TYPE: new Buffer([0xBE, 0xAB, 0x55, 0xCA]),
  PLAYER_NAME: new Buffer([0xFD, 0x6B, 0xB9, 0xDA]),
  PLAYER_PASSWORD: new Buffer([0x6C, 0xD1, 0x7C, 0x6E]),
  IS_CURRENT_TURN: new Buffer([0xCB, 0x21, 0xB0, 0x7A]),
  ACTOR_AI_HUMAN: new Buffer([0x95, 0xB9, 0x42, 0xCE]),  // 3 = Human, 1 = AI
  ACTOR_DESCRIPTION: new Buffer([0x65, 0x19, 0x9B, 0xFF])
};

// WHAT IS THE METHOD TO THIS MADNESS!?!?!?!
const CIV_SLOTS = {
  2: [2, 1],
  3: [2, 1, 3],
  4: [2, 1, 3, 4],
  5: [2, 5, 1, 3, 4],
  6: [2, 6, 5, 1, 3, 4],
  7: [2, 6, 5, 1, 3, 7, 4],
  8: [2, 6, 5, 1, 3, 7, 8, 4],
  9: [2, 6, 5, 1, 9, 3, 7, 8, 4],
  10: [2, 6, 10, 5, 1, 9, 3, 7, 8, 4]
};


module.exports.parse = (buffer, options) => {
  options = options || {};

  const result = {
    ACTORS: [],
    CIVS: []
  };

  let state = readState(buffer);

  if (state.next4.toString() !== 'CIV6') {
    throw new Error('Not a Civilzation 6 save file. :(');
  }

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

    if (info.marker.equals(START_ACTOR)) {
      result.ACTORS.push({
        pos: state.pos,
        data: readActor(info, buffer, state)
      });
    }
  } while (null !== (state = readState(buffer, state)));

  let fullCivs = [];

  for (let actor of _.clone(result.ACTORS)) {
    if (actor.data.ACTOR_TYPE.data === 'CIVILIZATION_LEVEL_FULL_CIV') {
      fullCivs.push(actor);
      _.pull(result.ACTORS, actor);
    }
  }

  for (let i = 0; i < fullCivs.length; i++) {
    result.CIVS[CIV_SLOTS[fullCivs.length][i] - 1] = fullCivs[i];
  }

  if (options.simple) {
    return simplify(result);
  }

  return result;
};

module.exports.modifyCiv = (buffer, civData, newValues) => {
  for (let key in newValues) {
    if (!civData.data[key]) {
      throw new Error('Adding a value that doesn\'t exist isn\'t supported yet.');
    }

    const civValue = civData.data[key];

    switch (civValue.type) {
      case 2:
        buffer = modifyInt(buffer, civValue, newValues[key]);
        break;

      case 5:
        buffer = modifyString(buffer, civValue, newValues[key]);
        break;

      default:
        throw new Error('I don\'t know how to modify type ' + civValue.type);
    }
  }

  return buffer;
};

if (!module.parent) {
  var argv = require('minimist')(process.argv.slice(2));
  if (!argv._.length) {
    console.log('Please pass the filename as the argument to the script.');
  } else {
    const buffer = new Buffer(fs.readFileSync(argv._[0]));
    const result = module.exports.parse(buffer, argv);
    console.log(util.inspect(result, false, null));
  }
}

// Helper functions

function simplify(result) {
  let mapFn = _.mapValues;

  if (_.isArray(result)) {
    mapFn = _.map;
  }

  return mapFn(result, i =>{
    if (i.data && !_.isObject(i.data)) {
      return i.data;
    }

    if (i.data === false) {
      return false;
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
        result.data = 'UNKNOWN!';
        state.pos += 12;
        break;

      case 0x15:
        result.data = 'UNKNOWN!';

        if (buffer.slice(state.pos, state.pos + 4).equals(new Buffer([0, 0, 0, 0x80]))) {
          state.pos += 20;
        } else {
          state.pos += 12;
        }
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

function readActor(info, buffer, state) {
  const result = {};

  do {
    if (info === null) {
      info = parseEntry(buffer, state);
    }

    for (let key in ACTOR_DATA) {
      if (info.marker.equals(ACTOR_DATA[key])) {
        result[key] = info;
      }
    }

    if (info.marker.equals(ACTOR_DATA.ACTOR_DESCRIPTION)) {
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

function modifyString(buffer, curValueData, newValue) {
  // Chop current buffer after the type...
  let resultBuffer = buffer.slice(0, curValueData.pos + 8);

  // Append new string length...
  const strLenBuffer = new Buffer([0, 0, 0, 0x21, 1, 0, 0, 0]);
  strLenBuffer.writeUInt16LE(newValue.length + 1, 0);
  resultBuffer = Buffer.concat([resultBuffer, strLenBuffer]);

  // Append new string...
  resultBuffer = Buffer.concat([resultBuffer, Buffer.from(newValue), new Buffer([0])]);

  // Append remainder of original buffer
  return Buffer.concat([resultBuffer, buffer.slice(curValueData.pos + 8 + 8 + curValueData.data.length + 1)]);
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

function modifyInt(buffer, curValueData, newValue) {
  // Chop current buffer after the type and padding...
  let resultBuffer = buffer.slice(0, curValueData.pos + 16);

  // Append new integer value...
  const valueBuffer = Buffer.alloc(4);
  valueBuffer.writeUInt32LE(newValue);
  resultBuffer = Buffer.concat([resultBuffer, valueBuffer]);

  // Append remainder of original buffer
  return Buffer.concat([resultBuffer, buffer.slice(curValueData.pos + 20)]);
}

function readCompressedData(buffer, state, filename) {
  const compressedData = buffer.slice(state.pos + 4, buffer.indexOf(COMPRESSED_DATA_END, state.pos));
  const uncompressedData = zlib.unzipSync(compressedData);
  fs.writeFileSync(filename, uncompressedData);
}
